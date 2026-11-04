package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * Remote control for the big screen's browser (Screen Remote: sneak + right-click). Works like a
 * normal browser: click the page, type (keys go to the page unless the address bar is focused),
 * scroll with the wheel, back / forward / reload, and an address bar for URLs or searches.
 * The wall mirrors it for everyone.
 */
public class BrowserScreen extends Screen {
	private static final int BG = 0xF00E0A16, BAR = 0xFF181226, LINE = 0xFF2A2140, TEXT = 0xFFECE8F4, DIM = 0xFF8E84A6;
	private static final int ACCENT = 0xFF8B5CF6, ACCENT_HI = 0xFFA078FF, PUMPKIN = 0xFFFF9A3C, HOVER = 0xFF2A2140;
	private static final float PAGE_ASPECT = 1280f / 598f;
	private static final Map<Integer, String> KEYS = Map.ofEntries(
		Map.entry(InputConstants.KEY_BACKSPACE, "Backspace"), Map.entry(InputConstants.KEY_RETURN, "Enter"),
		Map.entry(InputConstants.KEY_NUMPADENTER, "Enter"), Map.entry(InputConstants.KEY_TAB, "Tab"),
		Map.entry(InputConstants.KEY_DELETE, "Delete"), Map.entry(InputConstants.KEY_UP, "ArrowUp"),
		Map.entry(InputConstants.KEY_DOWN, "ArrowDown"), Map.entry(InputConstants.KEY_LEFT, "ArrowLeft"),
		Map.entry(InputConstants.KEY_RIGHT, "ArrowRight"), Map.entry(InputConstants.KEY_HOME, "Home"),
		Map.entry(InputConstants.KEY_END, "End"), Map.entry(InputConstants.KEY_PAGEUP, "PageUp"),
		Map.entry(InputConstants.KEY_PAGEDOWN, "PageDown"));

	private record Hit(int x0, int y0, int x1, int y1, Runnable action) {}

	private final List<Hit> hits = new ArrayList<>();
	private float k = 1f;
	private int vw, vh, mouseX, mouseY;
	private int px0, py0, px1, py1; // page rectangle
	private EditBox address;
	private final StringBuilder pendingText = new StringBuilder();
	private long pendingSince;
	private String lastUrl = "";

	public BrowserScreen() {
		super(Component.literal("Big screen browser"));
	}

	@Override
	protected void init() {
		int guiScale = Minecraft.getInstance().getWindow().getGuiScale();
		int px = Math.max(2, Math.round(guiScale * 0.5f));
		k = Math.min(1f, (float) px / Math.max(1, guiScale));
		vw = Math.round(width / k);
		vh = Math.round(height / k);
		int barY = 14, ax = 12 + 3 * 22 + 8, aw = vw - ax - 12 - 42;
		address = new EditBox(font, ax + 8, barY + 6, aw - 16, 12, Component.literal("address"));
		address.setBordered(false);
		address.setMaxLength(500);
		address.setTextColor(TEXT);
		address.setValue(ScreenTexture.url);
		lastUrl = ScreenTexture.url;
		addRenderableWidget(address);
		// Page fills the rest, keeping the 1280 x 598 shape.
		int top = barY + 32, bottom = vh - 26, maxW = vw - 24, maxH = bottom - top;
		int w = Math.min(maxW, Math.round(maxH * PAGE_ASPECT)), h = Math.round(w / PAGE_ASPECT);
		px0 = (vw - w) / 2;
		py0 = top + (maxH - h) / 2;
		px1 = px0 + w;
		py1 = py0 + h;
	}

	@Override
	public void tick() {
		// Follow page changes (links, redirects) unless the player is typing in the address bar.
		if (!address.isFocused() && !lastUrl.equals(ScreenTexture.url)) {
			address.setValue(ScreenTexture.url);
			lastUrl = ScreenTexture.url;
		}
		flushText(false);
	}

	private void flushText(boolean now) {
		if (pendingText.isEmpty()) return;
		if (!now && System.currentTimeMillis() - pendingSince < 120) return;
		org.slf4j.LoggerFactory.getLogger("hauntedcrew").info("[debug] send screen_text '{}'", pendingText);
		ClientConsole.send("screen_text", null, pendingText.toString(), null, null);
		pendingText.setLength(0);
	}

	private void go() {
		String text = address.getValue().trim();
		if (text.isEmpty() || text.equals("project preview")) return;
		ClientConsole.send("screen_go", null, text, null, null);
		address.setFocused(false);
		setFocused(null);
	}

	// ---------------------------------------------------------------- input

	private MouseButtonEvent zoomed(MouseButtonEvent e) {
		return new MouseButtonEvent(e.x() / k, e.y() / k, e.buttonInfo());
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent raw, boolean doubleClick) {
		MouseButtonEvent e = zoomed(raw);
		for (int i = hits.size() - 1; i >= 0; i--) {
			Hit h = hits.get(i);
			if (e.x() >= h.x0 && e.x() < h.x1 && e.y() >= h.y0 && e.y() < h.y1) {
				h.action.run();
				return true;
			}
		}
		if (e.x() >= px0 && e.x() < px1 && e.y() >= py0 && e.y() < py1) {
			address.setFocused(false);
			setFocused(null);
			double u = (e.x() - px0) / (px1 - px0), v = (e.y() - py0) / (py1 - py0);
			flushText(true);
			ClientConsole.send("screen_click", null, String.format(java.util.Locale.ROOT, "%.4f,%.4f", u, v), null, null);
			return true;
		}
		return super.mouseClicked(e, doubleClick);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		return super.mouseReleased(zoomed(event));
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double dx, double dy) {
		ClientConsole.send("screen_scroll", null, String.valueOf((int) (-dy * 120)), null, null);
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (address.isFocused()) {
			if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
				go();
				return true;
			}
			return super.keyPressed(event);
		}
		if (key == InputConstants.KEY_ESCAPE) {
			onClose();
			return true;
		}
		if (KEYS.containsKey(key)) {
			flushText(true);
			ClientConsole.send("screen_key", null, KEYS.get(key), null, null);
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		org.slf4j.LoggerFactory.getLogger("hauntedcrew").info("[debug] charTyped '{}' addressFocused={}", event.codepointAsString(), address.isFocused());
		if (address.isFocused()) return super.charTyped(event);
		if (pendingText.isEmpty()) pendingSince = System.currentTimeMillis();
		pendingText.append(event.codepointAsString());
		return true;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void onClose() {
		flushText(true);
		super.onClose();
	}

	// ---------------------------------------------------------------- drawing

	private static void round(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int c) {
		g.fill(ax + 2, ay, bx - 2, by, c);
		g.fill(ax + 1, ay + 1, ax + 2, by - 1, c);
		g.fill(bx - 2, ay + 1, bx - 1, by - 1, c);
		g.fill(ax, ay + 2, ax + 1, by - 2, c);
		g.fill(bx - 1, ay + 2, bx, by - 2, c);
	}

	private boolean hover(int ax, int ay, int bx, int by) {
		return mouseX >= ax && mouseX < bx && mouseY >= ay && mouseY < by;
	}

	private void iconButton(GuiGraphicsExtractor g, int x, int y, String icon, Runnable action) {
		boolean hot = hover(x, y, x + 20, y + 20);
		round(g, x, y, x + 20, y + 20, hot ? HOVER : BAR);
		g.centeredText(font, icon, x + 10, y + 6, hot ? TEXT : DIM);
		hits.add(new Hit(x, y, x + 20, y + 20, action));
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float partial) {
		g.fill(0, 0, width, height, 0xB0000000);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int rawX, int rawY, float partial) {
		mouseX = (int) (rawX / k);
		mouseY = (int) (rawY / k);
		hits.clear();
		g.pose().pushMatrix();
		g.pose().scale(k, k);

		round(g, 6, 6, vw - 6, vh - 6, 0xFF3B2A5E);
		round(g, 7, 7, vw - 7, vh - 7, BG);

		// Toolbar: navigation, address bar, tools, close.
		int y = 14, x = 12;
		iconButton(g, x, y, "◀", () -> ClientConsole.send("screen_nav", null, "back", null, null));
		iconButton(g, x + 22, y, "▶", () -> ClientConsole.send("screen_nav", null, "forward", null, null));
		iconButton(g, x + 44, y, "⟳", () -> ClientConsole.send("screen_nav", null, "reload", null, null));
		int ax = x + 3 * 22 + 8, aw = vw - ax - 12 - 42;
		round(g, ax, y, ax + aw, y + 20, address.isFocused() ? 0xFF5A44A0 : LINE);
		round(g, ax + 1, y + 1, ax + aw - 1, y + 19, BAR);
		hits.add(new Hit(ax, y, ax + aw, y + 20, () -> {
			setFocused(address);
			address.setFocused(true);
		}));

		int cx = vw - 12 - 34;
		boolean hotClose = hover(cx, y, cx + 34, y + 20);
		round(g, cx, y, cx + 34, y + 20, hotClose ? 0xFF8F2F3A : BAR);
		g.centeredText(font, "✕", cx + 17, y + 6, hotClose ? 0xFFFFFFFF : DIM);
		hits.add(new Hit(cx, y, cx + 34, y + 20, this::onClose));

		// Live page.
		round(g, px0 - 2, py0 - 2, px1 + 2, py1 + 2, address.isFocused() ? LINE : 0xFF5A44A0);
		if (ScreenTexture.ready()) g.blit(ScreenTexture.ID, px0, py0, px1, py1, 0f, 1f, 0f, 1f);
		else {
			g.fill(px0, py0, px1, py1, 0xFF0A0710);
			g.centeredText(font, "Switch the big screen to Website or Web search (right-click the remote)", (px0 + px1) / 2, (py0 + py1) / 2, DIM);
		}

		super.extractRenderState(g, mouseX, mouseY, partial);
		if (address.getValue().isEmpty() && !address.isFocused()) g.text(font, "Search DuckDuckGo or type a URL", address.getX(), address.getY(), DIM, false);

		// Status line.
		String hint = address.isFocused() ? "Enter to go   ·   click the page to type into it"
			: "Click the page, then type   ·   wheel scrolls   ·   Esc closes   ·   everyone sees this on the big screen";
		g.text(font, hint, 14, vh - 19, DIM, false);
		g.pose().popMatrix();
	}
}
