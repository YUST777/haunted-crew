package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.NativeImage;
import dev.hauntedcrew.HauntedCrew;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;

/**
 * Tutorial pictures and the trailer, scaled with a smooth filter to the exact pixel size they are drawn at, so
 * 1920x1080 screenshots stay crisp instead of aliasing under nearest-neighbour sampling. Render thread only,
 * decoding and scaling happen on a worker.
 */
final class TourMedia {
	private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
		Thread t = new Thread(r, "hauntedcrew-tour");
		t.setDaemon(true);
		return t;
	});

	private static final class Slot {
		final Identifier id;
		DynamicTexture texture;
		int w, h;          // size of the uploaded texture
		int wantW, wantH;  // size requested
		String key;        // what the uploaded texture shows
		String wantKey;
		final AtomicReference<NativeImage> ready = new AtomicReference<>();
		volatile boolean busy;

		Slot(String name) {
			id = HauntedCrew.id("dynamic/tour_" + name);
		}
	}

	private static final Map<String, Slot> SLOTS = new HashMap<>();

	private TourMedia() {}

	/** Texture ready to draw at pw x ph, or null while it is still loading. */
	static Identifier image(String name, int pw, int ph) {
		Slot s = SLOTS.computeIfAbsent("img", Slot::new);
		return poll(s, name, pw, ph, () -> scale(read("textures/gui/tour/" + name + ".png"), pw, ph));
	}

	// ---- trailer frames (jpegs packed in tour/trailer.bin: int count, int fps, int[count] lengths, data)
	private static byte[][] frames;
	private static int fps = 12;
	private static volatile boolean loadingFrames;

	/** The trailer frame for "now" scaled to pw x ph, or null while loading. */
	static Identifier video(long startMs, int pw, int ph) {
		if (frames == null) {
			if (!loadingFrames) {
				loadingFrames = true;
				WORKER.execute(TourMedia::loadFrames);
			}
			return null;
		}
		int idx = (int) ((System.currentTimeMillis() - startMs) * fps / 1000 % frames.length);
		Slot s = SLOTS.computeIfAbsent("video", Slot::new);
		return poll(s, "f" + idx, pw, ph, () -> scale(ImageIO.read(new ByteArrayInputStream(frames[idx])), pw, ph));
	}

	private interface Job {
		NativeImage run() throws Exception;
	}

	private static Identifier poll(Slot s, String key, int pw, int ph, Job job) {
		NativeImage img = s.ready.getAndSet(null);
		if (img != null) {
			if (s.texture == null || img.getWidth() != s.w || img.getHeight() != s.h) {
				if (s.texture != null) s.texture.close();
				s.w = img.getWidth();
				s.h = img.getHeight();
				s.texture = new DynamicTexture(() -> "hauntedcrew tour", img);
				Minecraft.getInstance().getTextureManager().register(s.id, s.texture);
			} else {
				s.texture.getPixels().copyFrom(img);
				img.close();
			}
			s.texture.upload();
			s.key = s.wantKey;
		}
		if (!s.busy && (!key.equals(s.key) || s.w != pw || s.h != ph) && (!key.equals(s.wantKey) || s.w != pw || s.h != ph)) {
			s.busy = true;
			s.wantKey = key;
			WORKER.execute(() -> {
				try {
					NativeImage out = job.run();
					NativeImage old = s.ready.getAndSet(out);
					if (old != null) old.close();
				} catch (Exception e) {
					// leave the slot empty; the screen draws a placeholder
				} finally {
					s.busy = false;
				}
			});
		}
		return s.texture == null ? null : s.id;
	}

	/** Size of the texture currently behind a slot id (so the caller blits it 1:1). */
	static int width(String slot) {
		Slot s = SLOTS.get(slot);
		return s == null ? 0 : s.w;
	}

	static int height(String slot) {
		Slot s = SLOTS.get(slot);
		return s == null ? 0 : s.h;
	}

	private static BufferedImage read(String path) throws Exception {
		try (InputStream in = Minecraft.getInstance().getResourceManager().getResourceOrThrow(HauntedCrew.id(path)).open()) {
			return ImageIO.read(in);
		}
	}

	private static void loadFrames() {
		try (InputStream raw = Minecraft.getInstance().getResourceManager().getResourceOrThrow(HauntedCrew.id("tour/trailer.bin")).open();
			DataInputStream in = new DataInputStream(new java.io.BufferedInputStream(raw))) {
			int n = in.readInt();
			fps = in.readInt();
			int[] len = new int[n];
			for (int i = 0; i < n; i++) len[i] = in.readInt();
			byte[][] f = new byte[n][];
			for (int i = 0; i < n; i++) {
				f[i] = new byte[len[i]];
				in.readFully(f[i]);
			}
			frames = f;
		} catch (Exception e) {
			frames = new byte[0][];
		}
	}

	/** Halve until within 2x of the target, then one bicubic step: sharp and alias free. */
	private static NativeImage scale(BufferedImage src, int w, int h) {
		BufferedImage cur = src;
		while (cur.getWidth() / 2 >= w && cur.getHeight() / 2 >= h) cur = step(cur, cur.getWidth() / 2, cur.getHeight() / 2);
		if (cur.getWidth() != w || cur.getHeight() != h) cur = step(cur, w, h);
		NativeImage out = new NativeImage(w, h, false);
		int[] argb = cur.getRGB(0, 0, w, h, null, 0, w);
		for (int y = 0; y < h; y++) {
			for (int x = 0; x < w; x++) out.setPixel(x, y, 0xFF000000 | argb[y * w + x]);
		}
		return out;
	}

	private static BufferedImage step(BufferedImage src, int w, int h) {
		BufferedImage dst = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
		var g = dst.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
		g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
		g.drawImage(src, 0, 0, w, h, null);
		g.dispose();
		return dst;
	}
}
