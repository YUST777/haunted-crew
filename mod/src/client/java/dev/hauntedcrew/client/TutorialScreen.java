package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/** Boo's tutorial: a feature drawer on the left, a short text and a screenshot on the right. Client only. */
public class TutorialScreen extends Screen {
	static final String INSTALL_PROMPT = """
		Install Haunted Crew for this project: it shows my Kiro agents as ghosts in a Minecraft office.
		Do every step yourself and check each result before the next one. Only ask me for things you
		cannot do (installing apps, signing in, clicking in the game).

		1. Check: `node --version` (need 20+), `kiro-cli --version`, `java -version` (optional).
		   If Node or kiro-cli is missing, tell me where to get it (nodejs.org, kiro.dev/downloads) and wait.
		2. Install the mod into Minecraft Java 26.3 (Fabric Loader + Fabric API + Haunted Crew):
		   `npx -y -p haunted-crew haunted-crew-minecraft`
		   Read its output. If it can't find my Minecraft folder, ask me for it and rerun with
		   `--minecraft-dir "<folder>"`. If Java is missing, ask me to run https://fabricmc.net/use/installer/
		   for 26.3, then rerun.
		3. Run `kiro-cli whoami`. If I'm not signed in, run `kiro-cli login` and wait for me.
		4. In this project folder, start the bridge in the background and keep it running:
		   `npx -y haunted-crew .`
		   Confirm its output shows the hooks installed, "signed in" and "running on 127.0.0.1:8787".
		5. Then tell me: open the Minecraft launcher, pick the Fabric 26.3 profile, create a world with
		   World Type "Haunted Office", right-click Boo for a tour, press K to summon ghosts.
		   Also give me the "workflows" link the bridge printed: it opens the workflow editor.
		""";
	private static final int PANEL = 0xFF2B2B2B, BTN = 0xFF6D6D6D, TEXT = 0xFFFFFFFF, DIM = 0xFFA0A0A0, GOLD = 0xFFFFAA00, CMD = 0xFF55FFFF, OK = 0xFF55FF55;
	private int CW = 430, CH = 240;
	private static final int DRAWER = 96;
	private final long openedAt = System.currentTimeMillis();

	/** image = texture name under textures/gui/tour (null = none), iw/ih = its pixel size. */
	private record Page(String name, String title, List<String> lines, String image, int iw, int ih, boolean install) {}

	private static final List<Page> PAGES = List.of(
		new Page("Welcome", "Welcome to the Haunted Office", List.of("Every ghost here is a real AI agent", "working on your real project.", "You give orders. They do the work."), "video", 1920, 1080, false),
		new Page("Connect", "Connect your crew", List.of("Paste this into your AI coding tool:"), null, 0, 0, true),
		new Page("Summon", "Summon a ghost", List.of("Press K, click + New ghost,", "pick a job and give it a task."), "summon", 1920, 1332, false),
		new Page("Chat", "Chat with it", List.of("Talk to a ghost like a chat.", "Type @ to mention a file."), "chat", 1920, 1080, false),
		new Page("Approvals", "Approve its work", List.of("A glowing ghost needs your OK.", "Press Allow or Reject."), "approval", 1920, 1080, false),
		new Page("Workflows", "Run a whole team", List.of("Chain ghosts: plan, code, test, review,", "or let a lead ghost delegate."), "workflows", 1920, 1165, false),
		new Page("Merges", "Review before merge", List.of("Each run works on its own git branch.", "Read the diff, then Merge or Reject."), "merges", 1920, 1080, false),
		new Page("Live code", "Watch code live", List.of("The big screen shows every edit.", "Right-click it with the Screen Remote."), "livecode", 1920, 1080, false),
		new Page("Browser", "Browse on the wall", List.of("Left-click the screen to browse.", "Sneak + right-click for full screen."), "browser", 1920, 1080, false),
		new Page("Models", "Pick a model", List.of("Choose a model for each ghost", "in the console."), "models", 1920, 1080, false),
		new Page("Ready", "You're ready!", List.of("Click below and I'll take you inside.", "Right-click me to see this again."), "ghost", 1920, 1332, false));

	private int page;
	private long copiedAt;

	public TutorialScreen() {
		super(Component.literal("Haunted Crew tutorial"));
	}

	@Override
	protected void init() {
		CW = Math.min(width - 16, 620);
		CH = Math.min(height - 16, 350);
	}

	private int x0() { return (width - CW) / 2; }
	private int y0() { return (height - CH) / 2; }
	private int cx() { return x0() + DRAWER + 12; }
	private int right() { return x0() + CW - 12; }
	private boolean last() { return page == PAGES.size() - 1; }

	private static boolean in(double mx, double my, int x, int y, int w, int h) {
		return mx >= x && mx < x + w && my >= y && my < y + h;
	}

	private int nextX() { return x0() + CW - 12 - 96; }
	private int backX() { return nextX() - 62; }
	private int btnY() { return y0() + CH - 26; }

	/** Close and walk the player into the office. */
	private void finish() {
		ClientConsole.send("tour_done", null, null, null, null);
		onClose();
	}

	private void next() {
		if (last()) finish(); else page++;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		double mx = e.x(), my = e.y();
		if (in(mx, my, nextX(), btnY(), 96, 18)) {
			next();
			return true;
		}
		if (page > 0 && in(mx, my, backX(), btnY(), 56, 18)) {
			page--;
			return true;
		}
		if (in(mx, my, cx(), btnY(), 50, 18)) {
			finish();
			return true;
		}
		for (int i = 0; i < PAGES.size(); i++) {
			if (in(mx, my, x0() + 6, y0() + 28 + i * 16, DRAWER - 6, 15)) {
				page = i;
				return true;
			}
		}
		if (PAGES.get(page).install() && in(mx, my, cx(), y0() + 120, 110, 18)) {
			Minecraft.getInstance().keyboardHandler.setClipboard(INSTALL_PROMPT);
			copiedAt = System.currentTimeMillis();
			return true;
		}
		return super.mouseClicked(e, dbl);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int k = event.key();
		if (k == InputConstants.KEY_RIGHT || k == InputConstants.KEY_RETURN || k == InputConstants.KEY_SPACE || k == InputConstants.KEY_DOWN) {
			next();
			return true;
		}
		if ((k == InputConstants.KEY_LEFT || k == InputConstants.KEY_UP) && page > 0) {
			page--;
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float partial) {
		g.fill(0, 0, width, height, 0xA0000000);
	}

	/** Minecraft-style bevelled box: black outline, light top-left edge, dark bottom-right edge. */
	private static void box(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int c) {
		int hi = shade(c, 0x38), lo = shade(c, -0x28);
		g.fill(ax, ay, bx, by, 0xFF000000);
		g.fill(ax + 1, ay + 1, bx - 1, by - 1, c);
		g.fill(ax + 1, ay + 1, bx - 1, ay + 2, hi);
		g.fill(ax + 1, ay + 1, ax + 2, by - 1, hi);
		g.fill(ax + 1, by - 2, bx - 1, by - 1, lo);
		g.fill(bx - 2, ay + 1, bx - 1, by - 1, lo);
	}

	private static int shade(int c, int d) {
		int r = Math.max(0, Math.min(255, (c >> 16 & 255) + d)), gr = Math.max(0, Math.min(255, (c >> 8 & 255) + d)), b = Math.max(0, Math.min(255, (c & 255) + d));
		return 0xFF000000 | r << 16 | gr << 8 | b;
	}

	private void button(GuiGraphicsExtractor g, int x, int y, int w, String label, int mx, int my) {
		boolean hot = in(mx, my, x, y, w, 18);
		box(g, x, y, x + w, y + 18, hot ? 0xFF8B8B8B : BTN);
		g.text(font, label, x + (w - font.width(label)) / 2, y + 5, hot ? 0xFFFFFFA0 : TEXT, true);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float partial) {
		super.extractRenderState(g, mx, my, partial);
		int x = x0(), y = y0();
		box(g, x - 2, y - 2, x + CW + 2, y + CH + 2, PANEL);
		// Drawer: one row per feature
		g.fill(x + 2, y + 2, x + DRAWER, y + CH - 2, 0xFF1A1A1A);
		g.text(font, "Tour", x + 8, y + 12, GOLD, true);
		for (int i = 0; i < PAGES.size(); i++) {
			int ry = y + 28 + i * 16;
			boolean cur = i == page, hot = in(mx, my, x + 6, ry, DRAWER - 6, 15);
			if (cur) box(g, x + 6, ry, x + DRAWER - 2, ry + 15, 0xFF5A5A5A);
			else if (hot) g.fill(x + 6, ry, x + DRAWER - 2, ry + 15, 0xFF333333);
			g.text(font, PAGES.get(i).name(), x + 12, ry + 4, cur ? 0xFFFFFFA0 : hot ? TEXT : DIM, true);
		}
		// Content
		Page p = PAGES.get(page);
		int cx = cx(), w = right() - cx;
		g.text(font, p.title(), cx, y + 12, GOLD, true);
		int ly = y + 28;
		for (String line : p.lines()) {
			g.text(font, line, cx, ly, TEXT, true);
			ly += 11;
		}
		if (p.image() != null) {
			int top = ly + 6, maxH = btnY() - 6 - top;
			double sc = Math.min((double) w / p.iw(), (double) maxH / p.ih());
			int dw = (int) (p.iw() * sc), dh = (int) (p.ih() * sc), ix = cx + (w - dw) / 2;
			g.fill(ix - 1, top - 1, ix + dw + 1, top + dh + 1, 0xFF000000);
			double gs = Minecraft.getInstance().getWindow().getGuiScale();
			int pw = Math.max(16, (int) (dw * gs)), ph = Math.max(16, (int) (dh * gs));
			boolean vid = "video".equals(p.image());
			Identifier tex = vid ? TourMedia.video(openedAt, pw, ph) : TourMedia.image(p.image(), pw, ph);
			String slot = vid ? "video" : "img";
			int tw = TourMedia.width(slot), th = TourMedia.height(slot);
			if (tex == null || tw == 0) g.text(font, "Loading...", ix + dw / 2 - 24, top + dh / 2 - 4, DIM, true);
			else g.blit(RenderPipelines.GUI_TEXTURED, tex, ix, top, 0f, 0f, dw, dh, tw, th, tw, th);
		}
		if (p.install()) {
			box(g, cx, y + 56, right(), y + 106, 0xFF161616);
			g.text(font, "Install Haunted Crew for this project...", cx + 6, y + 63, CMD, true);
			g.text(font, "Your AI tool installs the mod, signs in to", cx + 6, y + 75, CMD, true);
			g.text(font, "Kiro and starts the bridge (npx haunted-crew).", cx + 6, y + 87, CMD, true);
			boolean copied = System.currentTimeMillis() - copiedAt < 2500;
			button(g, cx, y + 120, 110, copied ? "Copied!" : "Copy prompt", mx, my);
			if (copied) g.text(font, "Now paste it in your AI tool.", cx + 118, y + 125, OK, true);
			g.text(font, "It checks every step and asks only when stuck.", cx, y + 150, DIM, true);
		}
		button(g, cx, btnY(), 50, "Skip", mx, my);
		if (page > 0) button(g, backX(), btnY(), 56, "Back", mx, my);
		button(g, nextX(), btnY(), 96, last() ? "Go to office" : "Next", mx, my);
	}
}
