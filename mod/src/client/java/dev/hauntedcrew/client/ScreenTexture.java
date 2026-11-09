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

	static void update(byte[] jpeg) {
		latestJpeg.set(jpeg);
		DECODER.execute(() -> {
			byte[] bytes = latestJpeg.getAndSet(null);
			if (bytes == null) return; // a newer frame already took this one's place
			NativeImage img;
			try {
				img = NativeImage.read(bytes);
			} catch (IOException | RuntimeException e) {
				return;
			}
			NativeImage stale = decoded.getAndSet(img);
			if (stale != null) stale.close();
			Minecraft.getInstance().execute(ScreenTexture::upload);
		});
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
