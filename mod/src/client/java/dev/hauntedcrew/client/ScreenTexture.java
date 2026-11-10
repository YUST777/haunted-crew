package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.NativeImage;
import dev.hauntedcrew.HauntedCrew;
import java.io.IOException;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;

/** The latest browser frame for the big screen, as a GPU texture. Render thread only. */
final class ScreenTexture {
	static final Identifier ID = HauntedCrew.id("dynamic/screen");
	private static DynamicTexture texture;
	private static int width, height;
	/** Page shown on the big screen ("project preview" for the workspace site). */
	static String url = "";

	private ScreenTexture() {}

	static int width() {
		return width;
	}

	static int height() {
		return height;
	}

	static boolean ready() {
		return texture != null;
	}

	static void update(byte[] jpeg, String pageUrl) {
		url = pageUrl == null ? "" : pageUrl;
		update(jpeg);
	}

	// JPEG decoding (a 2K frame takes tens of ms) runs on a worker so the render thread never stalls;
	// only the newest frame is kept, and only the GPU upload happens on the render thread.
	private static final java.util.concurrent.ExecutorService DECODER = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
		Thread t = new Thread(r, "hauntedcrew-screen-decode");
		t.setDaemon(true);
		return t;
	});
	private static final java.util.concurrent.atomic.AtomicReference<byte[]> latestJpeg = new java.util.concurrent.atomic.AtomicReference<>();
	private static final java.util.concurrent.atomic.AtomicReference<NativeImage> decoded = new java.util.concurrent.atomic.AtomicReference<>();

	private static volatile long lastSeen;

	/** Called whenever the wall (or the browser screen) is drawn; frames are only decoded while someone looks (the study's distance culling). */
	static void touch() {
		boolean wasHidden = !seen();
		lastSeen = System.nanoTime();
		if (wasHidden && latestJpeg.get() != null) decode();
	}

	private static boolean seen() {
		return System.nanoTime() - lastSeen < 2_000_000_000L;
	}

	static void update(byte[] jpeg) {
		latestJpeg.set(jpeg);
		if (seen()) decode();
	}

	private static void decode() {
		DECODER.execute(() -> {
			byte[] bytes = latestJpeg.getAndSet(null);
			if (bytes == null) return; // a newer frame already took this one's place
			NativeImage img = decodeJpeg(bytes);
			if (img == null) return;
			NativeImage stale = decoded.getAndSet(img);
			if (stale != null) stale.close();
			Minecraft.getInstance().execute(ScreenTexture::upload);
		});
	}

	/** Minecraft's native (stb) reader first; ImageIO if it refuses JPEG. */
	private static NativeImage decodeJpeg(byte[] bytes) {
		try {
			return NativeImage.read(bytes);
		} catch (IOException | RuntimeException e) {
			// not decodable natively; use ImageIO below
		}
		try {
			java.awt.image.BufferedImage src = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes));
			if (src == null) return null;
			int w = src.getWidth(), h = src.getHeight();
			NativeImage out = new NativeImage(w, h, false);
			int[] argb = src.getRGB(0, 0, w, h, null, 0, w);
			for (int y = 0; y < h; y++) {
				for (int x = 0; x < w; x++) out.setPixel(x, y, 0xFF000000 | argb[y * w + x]);
			}
			return out;
		} catch (IOException | RuntimeException e) {
			return null;
		}
	}

	private static void upload() {
		NativeImage img = decoded.getAndSet(null);
		if (img == null) return;
		if (texture == null || img.getWidth() != width || img.getHeight() != height) {
			if (texture != null) texture.close();
			width = img.getWidth();
			height = img.getHeight();
			texture = new DynamicTexture(() -> "hauntedcrew screen", img);
			Minecraft.getInstance().getTextureManager().register(ID, texture);
		} else {
			texture.getPixels().copyFrom(img);
			img.close();
		}
		texture.upload();
	}
}
