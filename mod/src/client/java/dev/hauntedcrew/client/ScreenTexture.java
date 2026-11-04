package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.NativeImage;
import dev.hauntedcrew.HauntedCrew;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import javax.imageio.ImageIO;
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

	static void update(byte[] jpeg) {
		// Fast path: Minecraft's native (stb) decoder; falls back to ImageIO if it refuses JPEG.
		try {
			NativeImage decoded = NativeImage.read(jpeg);
			if (texture == null || decoded.getWidth() != width || decoded.getHeight() != height) {
				if (texture != null) texture.close();
				width = decoded.getWidth();
				height = decoded.getHeight();
				texture = new DynamicTexture(() -> "hauntedcrew screen", decoded);
				Minecraft.getInstance().getTextureManager().register(ID, texture);
			} else {
				texture.getPixels().copyFrom(decoded);
				decoded.close();
			}
			texture.upload();
			return;
		} catch (IOException | RuntimeException e) {
			// not decodable natively; use ImageIO below
		}
		BufferedImage img;
		try {
			img = ImageIO.read(new ByteArrayInputStream(jpeg));
		} catch (IOException e) {
			return;
		}
		if (img == null) return;
		int w = img.getWidth(), h = img.getHeight();
		if (texture == null || w != width || h != height) {
			if (texture != null) texture.close();
			texture = new DynamicTexture(() -> "hauntedcrew screen", w, h, false);
			width = w;
			height = h;
			Minecraft.getInstance().getTextureManager().register(ID, texture);
		}
		NativeImage pixels = texture.getPixels();
		int[] argb = img.getRGB(0, 0, w, h, null, 0, w);
		for (int y = 0; y < h; y++) {
			for (int x = 0; x < w; x++) pixels.setPixel(x, y, 0xFF000000 | argb[y * w + x]);
		}
		texture.upload();
	}
}
