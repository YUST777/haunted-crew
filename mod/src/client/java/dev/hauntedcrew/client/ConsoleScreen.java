package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.hauntedcrew.CrewProtocol;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.ConfirmLinkScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

/**
 * The agent console, laid out like an AI chat app: ghosts in a sidebar, one conversation per ghost
 * (plus a #crew channel with everyone), bubbles for you and the agent, compact activity lines for
 * tool calls, approval cards inline, and onboarding / Kiro sign-in cards when something is missing.
 * Open with the "Open agent console" key (Options > Controls > Haunted Crew, default K).
 */
public class ConsoleScreen extends Screen {
	// Palette: night purple with pumpkin accents.
	private static int BG = 0xF00E0A16, SIDEBAR = 0xFF140F1F, CHAT = 0xFF100C19, LINE = 0xFF2A2140;
	private static int TEXT = 0xFFECE8F4, DIM = 0xFF8E84A6, FAINT = 0xFF5E5675;
	private static int ACCENT = 0xFF8B5CF6, ACCENT_HI = 0xFFA078FF, PUMPKIN = 0xFFFF9A3C;
	private static int USER_BUBBLE = 0xFF6D45D8, AGENT_BUBBLE = 0xFF221A33, CARD = 0xFF1B1429;
	private static int OK = 0xFF4ADE80, WARN = 0xFFFFC94D, BAD = 0xFFFF6B6B, SELECT = 0xFF241B38;
	private static final int ROW = 30, HEADER = 30, INPUT = 28, PAD = 10;

	// Two looks: the Kiro purple night theme (default) and a vanilla Minecraft one (bevelled grey boxes, gold and
	// chat colours, text shadows). F6 in the console flips it; Minecraft style is the default; -Dhauntedcrew.ui=kiro starts in purple.
	static boolean mc = !"kiro".equals(System.getProperty("hauntedcrew.ui")); // package-private: WorkflowScreen follows it
	private static boolean shadow;
	static {
		applyStyle();
	}

	private static void applyStyle() {
		shadow = mc;
		if (mc) {
			BG = 0xF0101010; SIDEBAR = 0xFF2B2B2B; CHAT = 0xFF161616; LINE = 0xFF000000;
			TEXT = 0xFFFFFFFF; DIM = 0xFFA0A0A0; FAINT = 0xFF707070;
			ACCENT = 0xFF6D6D6D; ACCENT_HI = 0xFF8B8B8B; PUMPKIN = 0xFFFFAA00;
			USER_BUBBLE = 0xFF35557E; AGENT_BUBBLE = 0xFF3A3A3A; CARD = 0xFF4A4A4A;
			OK = 0xFF55FF55; WARN = 0xFFFFFF55; BAD = 0xFFFF5555; SELECT = 0xFF5A5A5A;
		} else {
			BG = 0xF00E0A16; SIDEBAR = 0xFF140F1F; CHAT = 0xFF100C19; LINE = 0xFF2A2140;
			TEXT = 0xFFECE8F4; DIM = 0xFF8E84A6; FAINT = 0xFF5E5675;
			ACCENT = 0xFF8B5CF6; ACCENT_HI = 0xFFA078FF; PUMPKIN = 0xFFFF9A3C;
			USER_BUBBLE = 0xFF6D45D8; AGENT_BUBBLE = 0xFF221A33; CARD = 0xFF1B1429;
			OK = 0xFF4ADE80; WARN = 0xFFFFC94D; BAD = 0xFFFF6B6B; SELECT = 0xFF241B38;
		}
	}

	/** Purple-theme literals used in a few round() calls, as their Minecraft-style twins. */
	private static int mcColor(int c) {
		return switch (c) {
			case 0xFF3B2A5E -> 0xFF000000; // frame and card borders
			case 0xFF5A44A0 -> 0xFFFFFFFF; // focused input
			case 0xFF181226 -> 0xFF000000; // input field
			case 0xFF2A2338, 0xFF241B38 -> 0xFF3A3A3A; // disabled, chips
			case 0xFF3A2C58 -> 0xFF7A7A7A; // hovered button
			case 0xFF1A1428 -> 0xFF555555; // selected row
			case 0xFF2C2244 -> 0xFF4A4A4A;
			case 0xFF3A2A12 -> 0xFF4A3A10;
			case 0xFFB8862A -> 0xFFFFAA00; // approval card border
			case 0xFF241C10 -> 0xFF2A2A2A; // approval card fill
			default -> c;
		};
	}

	private enum Mode { CHAT, NEW_GHOST, PAIR }

	private int mentionSel;

	private record Hit(int x0, int y0, int x1, int y1, Runnable action) {}

	/** Right-click menu on a ghost in the sidebar: which ghost, where, and the clickable ghost rows of this frame. */
	private record Row(int x0, int y0, int x1, int y1, String id) {}
	private final List<Row> rows = new ArrayList<>();
	private String menuId;
	private int menuX, menuY, menuW, menuH;

	@FunctionalInterface
	private interface Painter {
		void draw(GuiGraphicsExtractor g, int left, int y, int right);
	}

	/** One laid-out item in the conversation. Sticky blocks (banners) don't count as content. */
	private record Block(int height, Painter draw, boolean sticky) {
		Block(int height, Painter draw) {
			this(height, draw, false);
		}
	}

	private final List<Hit> hits = new ArrayList<>();
	private int x0, y0, x1, y1, side, chatX0;
	// The console draws at its own zoom (k) so big GUI scales don't make it huge; vw/vh are the zoomed size.
	private float k = 1f;
	private int vw, vh;
	private String selected; // session id; null = #crew channel
	private Mode mode = Mode.CHAT;
	private EditBox input;
	private int scroll; // px scrolled up from the bottom
	private int mouseX, mouseY;
	private int ticks;
	private String pendingSelect; // name of a ghost we just summoned
	private int sendPendingAt;
	private String pendingSession;
	private String pendingMessage; // what to tell it once it has joined (from "@Coder fix the tests")
	private int seenVersion;
	private int sideScroll; // ghosts scrolled past in the sidebar
	// Kiro models for new ghosts: id, label. Cheap and fast first.
	private static final String[][] MODELS = {
		{"claude-haiku-5.5", "Haiku 5.5 · fast · 0.06x"}, {"qwen3-coder-next", "Qwen3 Coder · 0.05x"}, {"claude-sonnet-5.5", "Sonnet 5.5 · 1.3x"},
		{"claude-opus-5.5", "Opus 5.5 · 2x"}, {"auto", "Auto · 1x"}};
	private static int modelIndex;
	private static final java.util.Set<String> expanded = new java.util.HashSet<>(); // opened "Thought for" blocks

	public ConsoleScreen() {
		super(Component.translatable("screen.hauntedcrew.console"));
	}

	@Override
	protected void init() {
		int guiScale = Minecraft.getInstance().getWindow().getGuiScale();
		// Half the normal GUI size, rounded to whole screen pixels so the pixel font stays crisp.
		int px = Math.max(2, Math.round(guiScale * 0.5f));
		k = Math.min(1f, (float) px / Math.max(1, guiScale));
		vw = Math.round(width / k);
		vh = Math.round(height / k);
		x0 = 8;
		y0 = 8;
		x1 = vw - 8;
		y1 = vh - 8;
		side = vw < 460 ? 118 : 156;
		chatX0 = x0 + side;
		String draft = input == null ? "" : input.getValue();
		int ix = chatX0 + PAD + 8, iy = y1 - PAD - INPUT + 10;
		input = new EditBox(font, ix, iy, x1 - PAD - 34 - ix - 128, 12, Component.translatable("screen.hauntedcrew.console.input"));
		input.setBordered(false);
		input.setMaxLength(4000);
		input.setTextColor(TEXT);
		input.setTextColorUneditable(FAINT);
		input.setValue(draft);
		addRenderableWidget(input);
		setInitialFocus(input);
		seenVersion = ClientConsole.version;
		refreshInput();
	}

	// ---------------------------------------------------------------- state helpers

	private CrewProtocol.Session current() {
		return selected == null ? null : ClientConsole.sessions.get(selected);
	}

	private boolean onboarding() {
		return !ClientConsole.connected() && "none".equals(ClientConsole.source);
	}

	private String placeholder() {
		if (mode == Mode.PAIR) return "HC-XXXX-XXXX  ws://bridge-host:8787/stream";
		if (!ClientConsole.canCommand) return ClientConsole.connected() ? "Watch-only: ask the world owner to command" : "Connect a bridge first";
		if (mode == Mode.NEW_GHOST) return "Name your ghost, e.g. Coder, then Enter";
		CrewProtocol.Session s = current();
		if (s == null) return "Message the crew with @Name, e.g. @Coder fix the tests";
		if (!s.console()) return s.label() + " runs in Kiro IDE: watch-only";
		return "Message " + s.label() + "…";
	}

	private void refreshInput() {
		input.setEditable(mode == Mode.PAIR || ClientConsole.canCommand);
	}

	private void submit() {
		String text = input.getValue().trim();
		if (text.isEmpty()) return;
		switch (mode) {
			case PAIR -> {
				String[] parts = text.split("\\s+", 2);
				ClientConsole.send("pair", parts.length > 1 ? parts[1] : null, parts[0], null, null);
				mode = Mode.CHAT;
			}
			case NEW_GHOST -> {
				summon(text);
				return;
			}
			case CHAT -> {
				if (!ClientConsole.canCommand) return;
				CrewProtocol.Session target = current();
				String message = text;
				if (target == null) {
					if (!text.startsWith("@")) {
						toast("Start with @Name to pick a ghost, e.g. @Coder fix the tests");
						return;
					}
					// Names may contain spaces ("Spirit 22"): take the longest ghost name the text starts with.
					String rest = text.substring(1), lower = rest.toLowerCase(Locale.ROOT);
					for (CrewProtocol.Session c : ClientConsole.sessions.values()) {
						String n = c.label().toLowerCase(Locale.ROOT);
						if ((lower.startsWith(n + " ") || lower.equals(n)) && (target == null || n.length() > target.label().length())) target = c;
					}
					String[] parts = rest.split("\\s+", 2);
					if (target == null) target = byName(parts[0]);
					else parts = new String[] {rest.substring(0, target.label().length()), rest.substring(target.label().length()).strip()};
					String job = target == null ? jobName(parts[0]) : null;
					if (job != null && parts.length > 1 && !parts[1].isEmpty()) { // "@Coder fix it": summon the job, then send
						pendingMessage = parts[1];
						summon(job);
						return;
					}
					if (target == null || parts.length < 2 || parts[1].isEmpty()) {
						toast(target == null ? "No ghost called " + parts[0] + " here. Summon one first." : "Add a message after the name.");
						return;
					}
					message = parts[1];
				}
				if (!target.console()) {
					toast(target.label() + " runs in Kiro IDE and can't take messages from here.");
					return;
				}
				if (needsKiro()) return;
				ClientConsole.send("prompt", target.id(), message, null, null);
				scroll = 0;
			}
		}
		input.setValue("");
		refreshInput();
	}

	private boolean needsKiro() {
		if (ClientConsole.kiro == null || ClientConsole.kiroReady()) return false;
		toast("Sign in to Kiro first: use the Sign in button.");
		return true;
	}

	private void summon(String name) {
		if (!ClientConsole.canCommand || needsKiro()) return;
		ClientConsole.send("spawn", null, name, null, MODELS[modelIndex][0]);
		toast("Summoning " + name + " on " + MODELS[modelIndex][1] + "…");
		pendingSelect = name;
		mode = Mode.CHAT;
		input.setValue("");
		refreshInput();
	}

	private CrewProtocol.Session byName(String name) {
		for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
			if (s.label().equalsIgnoreCase(name)) return s;
		}
		for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
			if (s.label().toLowerCase(Locale.ROOT).startsWith(name.toLowerCase(Locale.ROOT))) return s;
		}
		return null;
	}

	private static void toast(String text) {
		ClientConsole.notice = text;
		ClientConsole.noticeAt = System.currentTimeMillis();
	}

	@Override
	public void tick() {
		ticks++;
		if (seenVersion != ClientConsole.version) {
			seenVersion = ClientConsole.version;
			if (pendingSelect != null) {
				for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
					if (s.console() && pendingSelect.equalsIgnoreCase(s.agent())) {
						selected = s.id();
						pendingSession = s.id();
						pendingSelect = null;
						if (pendingMessage != null) sendPendingAt = ticks + 10; // the server drops actions inside 300 ms of the summon
						scroll = 0;
						break;
					}
				}
			}
			if (selected != null && current() == null) selected = null;
		}
		if (pendingMessage != null && pendingSession != null && ticks >= sendPendingAt && sendPendingAt > 0) {
			ClientConsole.send("prompt", pendingSession, pendingMessage, null, null);
			pendingMessage = null;
			pendingSession = null;
			sendPendingAt = 0;
		}
		// While a Kiro sign-in is open in the browser, check every 3 s whether it finished.
		if (ClientConsole.loginCode != null && ticks % 60 == 0) ClientConsole.send("kiro_status", null, null, null, null);
		refreshInput();
	}

	// ---------------------------------------------------------------- input

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_F6) {
			mc = !mc;
			applyStyle();
			return true;
		}
		List<CrewProtocol.Session> mentions = mentionMatches();
		if (!mentions.isEmpty()) {
			if (key == InputConstants.KEY_DOWN || key == InputConstants.KEY_UP) {
				mentionSel = Math.floorMod(mentionSel + (key == InputConstants.KEY_DOWN ? 1 : -1), mentions.size());
				return true;
			}
			if (key == InputConstants.KEY_TAB || key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
				completeMention(mentions.get(Math.min(mentionSel, mentions.size() - 1)));
				return true;
			}
		}
		List<String> bring = summonMatches();
		if (!bring.isEmpty()) {
			if (key == InputConstants.KEY_DOWN || key == InputConstants.KEY_UP) {
				mentionSel = Math.floorMod(mentionSel + (key == InputConstants.KEY_DOWN ? 1 : -1), bring.size());
				return true;
			}
			if (key == InputConstants.KEY_TAB || key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
				fillSummonMention(bring.get(Math.min(mentionSel, bring.size() - 1)));
				return true;
			}
		}
		if (key == InputConstants.KEY_RETURN || key == InputConstants.KEY_NUMPADENTER) {
			submit();
			return true;
		}
		if (key == InputConstants.KEY_ESCAPE && mode != Mode.CHAT) {
			mode = Mode.CHAT;
			input.setValue("");
			refreshInput();
			return true;
		}
		return super.keyPressed(event);
	}

	// ---------------------------------------------------------------- @mentions

	/** Index of the '@' that starts the name being typed at the cursor, or -1. */
	private int mentionStart() {
		if (mode != Mode.CHAT || !ClientConsole.canCommand || input == null) return -1;
		String text = input.getValue();
		int cur = Math.min(input.getCursorPosition(), text.length());
		int at = text.lastIndexOf('@', Math.max(0, cur - 1));
		if (at < 0 || at >= cur || (at > 0 && !Character.isWhitespace(text.charAt(at - 1)))) return -1;
		return at;
	}

	/** Console ghosts whose name starts with what's typed after the '@' (names may contain spaces), one per name. */
	private List<CrewProtocol.Session> mentionMatches() {
		int at = mentionStart();
		if (at < 0) return List.of();
		String text = input.getValue();
		String frag = text.substring(at + 1, Math.min(input.getCursorPosition(), text.length())).toLowerCase(Locale.ROOT);
		List<CrewProtocol.Session> out = new ArrayList<>();
		java.util.Set<String> seen = new java.util.HashSet<>();
		for (CrewProtocol.Session c : ClientConsole.sessions.values()) {
			String n = c.label().toLowerCase(Locale.ROOT);
			if (c.console() && n.startsWith(frag) && seen.add(n)) out.add(c);
		}
		return out;
	}

	/** No ghost matches the @: offer the jobs you can summon right here (Planner, Coder...), skipping names already in the crew. */
	private List<String> summonMatches() {
		int at = mentionStart();
		if (at < 0 || !mentionMatches().isEmpty()) return List.of();
		String text = input.getValue();
		String frag = text.substring(at + 1, Math.min(input.getCursorPosition(), text.length())).toLowerCase(Locale.ROOT);
		List<String> out = new ArrayList<>();
		for (CrewProtocol.Job j : CrewProtocol.Job.WORKERS) {
			String name = j.name().charAt(0) + j.name().substring(1).toLowerCase(Locale.ROOT);
			if (name.toLowerCase(Locale.ROOT).startsWith(frag) && byName(name) == null) out.add(name);
		}
		return out;
	}

	/** Canonical job name ("Coder") for a typed name, or null; only when no ghost of that name exists yet. */
	private String jobName(String typed) {
		for (CrewProtocol.Job j : CrewProtocol.Job.WORKERS) {
			String name = j.name().charAt(0) + j.name().substring(1).toLowerCase(Locale.ROOT);
			if (name.equalsIgnoreCase(typed) && byName(name) == null) return name;
		}
		return null;
	}

	/** Fills "@Name " into the input for a summonable job. */
	private void fillSummonMention(String name) {
		int at = mentionStart();
		if (at < 0) return;
		String text = input.getValue();
		int cur = Math.min(input.getCursorPosition(), text.length());
		String insert = "@" + name + " ";
		input.setValue(text.substring(0, at) + insert + text.substring(cur));
		input.setCursorPosition(at + insert.length());
		mentionSel = 0;
	}

	private void completeMention(CrewProtocol.Session s) {
		int at = mentionStart();
		if (at < 0) return;
		String text = input.getValue();
		int cur = Math.min(input.getCursorPosition(), text.length());
		String insert = "@" + s.label() + " ";
		input.setValue(text.substring(0, at) + insert + text.substring(cur));
		input.setCursorPosition(at + insert.length());
		mentionSel = 0;
	}

	private void drawMentions(GuiGraphicsExtractor g) {
		List<CrewProtocol.Session> all = mentionMatches();
		if (all.isEmpty()) {
			drawSummonMentions(g);
			return;
		}
		List<CrewProtocol.Session> list = all.size() > 6 ? all.subList(0, 6) : all;
		mentionSel = Math.min(mentionSel, list.size() - 1);
		int rowH = 16, w = 190, x = chatX0 + PAD, h = list.size() * rowH + 6 + 12, yb = y1 - PAD - INPUT - 4, yt = yb - h;
		round(g, x, yt, x + w, yb, CARD);
		for (int i = 0; i < list.size(); i++) {
			CrewProtocol.Session s = list.get(i);
			int ry = yt + 3 + i * rowH;
			boolean on = i == mentionSel || hover(x + 2, ry, x + w - 2, ry + rowH);
			if (on) round(g, x + 2, ry, x + w - 2, ry + rowH, SELECT);
			avatar(g, x + 5, ry + 2, 12, s.label(), s.status());
			g.text(font, s.label(), x + 22, ry + 4, on ? TEXT : DIM, shadow);
			String act = trim(s.activity(), 70);
			g.text(font, act, x + w - 6 - font.width(act), ry + 4, FAINT, shadow);
			final int idx = i;
			hits.add(new Hit(x + 2, ry, x + w - 2, ry + rowH, () -> completeMention(list.get(idx))));
		}
		g.text(font, "↑↓ choose · Tab to add", x + 6, yb - 12, FAINT, shadow);
	}

	private void drawSummonMentions(GuiGraphicsExtractor g) {
		List<String> all = summonMatches();
		if (all.isEmpty()) return;
		mentionSel = Math.min(mentionSel, all.size() - 1);
		int rowH = 16, w = 190, x = chatX0 + PAD, h = all.size() * rowH + 6 + 12, yb = y1 - PAD - INPUT - 4, yt = yb - h;
		round(g, x, yt, x + w, yb, CARD);
		for (int i = 0; i < all.size(); i++) {
			String name = all.get(i);
			int ry = yt + 3 + i * rowH;
			boolean on = i == mentionSel || hover(x + 2, ry, x + w - 2, ry + rowH);
			if (on) round(g, x + 2, ry, x + w - 2, ry + rowH, SELECT);
			avatar(g, x + 5, ry + 2, 12, name, null);
			g.text(font, name, x + 22, ry + 4, on ? TEXT : DIM, shadow);
			g.text(font, "new", x + w - 6 - font.width("new"), ry + 4, PUMPKIN, shadow);
			hits.add(new Hit(x + 2, ry, x + w - 2, ry + rowH, () -> fillSummonMention(name)));
		}
		g.text(font, "↑↓ choose · Tab to add", x + 6, yb - 12, FAINT, shadow);
	}

	private MouseButtonEvent zoomed(MouseButtonEvent e) {
		return new MouseButtonEvent(e.x() / k, e.y() / k, e.buttonInfo());
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		return super.mouseReleased(zoomed(event));
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dx, double dy) {
		return super.mouseDragged(zoomed(event), dx / k, dy / k);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent raw, boolean doubleClick) {
		MouseButtonEvent event = zoomed(raw);
		if (event.buttonInfo().button() == 1) { // right-click a ghost: its menu
			for (Row r : rows) {
				if (event.x() >= r.x0 && event.x() < r.x1 && event.y() >= r.y0 && event.y() < r.y1) {
					menuId = r.id;
					menuX = (int) event.x();
					menuY = (int) event.y();
					return true;
				}
			}
			menuId = null; // right-click anywhere else acts like a normal click (some mice report the main button as 1)
		} else if (menuId != null && !inRect(new int[] {menuX, menuY, menuX + menuW, menuY + menuH}, event.x(), event.y())) {
			menuId = null; // a click outside closes the menu without doing anything else
			return true;
		}
		if ((modelMenu || ctxPanel) && !inRect(panelRect, event.x(), event.y()) && !inRect(toggleRects, event.x(), event.y())) {
			modelMenu = false;
			ctxPanel = false;
		}
		for (int i = hits.size() - 1; i >= 0; i--) {
			Hit h = hits.get(i);
			if (event.x() >= h.x0 && event.x() < h.x1 && event.y() >= h.y0 && event.y() < h.y1) {
				h.action.run();
				refreshInput();
				return true;
			}
		}
		return super.mouseClicked(event, doubleClick);
	}

	private static boolean inRect(int[] r, double x, double y) {
		if (r == null) return false;
		for (int i = 0; i + 3 < r.length; i += 4) if (x >= r[i] && x < r[i + 2] && y >= r[i + 1] && y < r[i + 3]) return true;
		return false;
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double dx, double dy) {
		if (mx / k >= chatX0) scroll = Math.max(0, scroll + (int) (dy * 24));
		else sideScroll = Math.max(0, Math.min(ClientConsole.sessions.size() - 1, sideScroll - (int) Math.signum(dy)));
		return true;
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ---------------------------------------------------------------- drawing primitives

	private static int shade(int c, int d) {
		int r = Math.max(0, Math.min(255, ((c >> 16) & 255) + d)), gr = Math.max(0, Math.min(255, ((c >> 8) & 255) + d)), b = Math.max(0, Math.min(255, (c & 255) + d));
		return (c & 0xFF000000) | (r << 16) | (gr << 8) | b;
	}

	private static void round(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int color) {
		if (mc) {
			int c = mcColor(color), hi = shade(c, 0x38), lo = shade(c, -0x28);
			g.fill(ax, ay, bx, by, 0xFF000000);
			g.fill(ax + 1, ay + 1, bx - 1, by - 1, c);
			g.fill(ax + 1, ay + 1, bx - 1, ay + 2, hi);
			g.fill(ax + 1, ay + 1, ax + 2, by - 1, hi);
			g.fill(ax + 1, by - 2, bx - 1, by - 1, lo);
			g.fill(bx - 2, ay + 1, bx - 1, by - 1, lo);
			return;
		}
		g.fill(ax + 2, ay, bx - 2, by, color);
		g.fill(ax + 1, ay + 1, ax + 2, by - 1, color);
		g.fill(bx - 2, ay + 1, bx - 1, by - 1, color);
		g.fill(ax, ay + 2, ax + 1, by - 2, color);
		g.fill(bx - 1, ay + 2, bx, by - 2, color);
	}

	private boolean hover(int ax, int ay, int bx, int by) {
		return mouseX >= ax && mouseX < bx && mouseY >= ay && mouseY < by;
	}

	/** Pill button; returns its right edge. */
	private int button(GuiGraphicsExtractor g, int x, int y, String label, int color, Runnable action) {
		int w = font.width(label) + 14;
		boolean hot = hover(x, y, x + w, y + 16);
		round(g, x, y, x + w, y + 16, hot ? brighten(color) : color);
		g.text(font, label, x + 7, y + 4, 0xFFFFFFFF, shadow);
		hits.add(new Hit(x, y, x + w, y + 16, action));
		return x + w;
	}

	private static int brighten(int c) {
		int r = Math.min(255, ((c >> 16) & 0xFF) + 28), gr = Math.min(255, ((c >> 8) & 0xFF) + 28), b = Math.min(255, (c & 0xFF) + 28);
		return (c & 0xFF000000) | (r << 16) | (gr << 8) | b;
	}

	static int jobColor(String name) {
		CrewProtocol.Job job = CrewProtocol.Job.fromName(name);
		if (job == null) return 0xFF7A7090;
		return switch (job) {
			case PLANNER -> 0xFF7B4FC0;
			case CODER -> 0xFFE0B020;
			case TESTER -> 0xFF3FA9DE;
			case REVIEWER -> 0xFF8B5E3C;
			case DOCS -> 0xFFD04848;
			case RESEARCHER -> 0xFFC8A165;
			case GUIDE -> 0xFFFF9A3C;
		};
	}

	/** Little ghost face on a job-coloured tile, with an optional status dot. */
	private static void avatar(GuiGraphicsExtractor g, int x, int y, int size, String name, CrewProtocol.Status status) {
		round(g, x, y, x + size, y + size, jobColor(name));
		int m = size / 5;
		g.fill(x + m, y + m, x + size - m, y + size - m / 2, 0xFFF2F0FF);
		int eye = Math.max(1, size / 8);
		g.fill(x + size / 2 - eye * 2, y + size / 2 - eye, x + size / 2 - eye, y + size / 2 + eye, 0xFF1A1426);
		g.fill(x + size / 2 + eye, y + size / 2 - eye, x + size / 2 + eye * 2, y + size / 2 + eye, 0xFF1A1426);
		if (status != null) {
			g.fill(x + size - 5, y + size - 5, x + size + 1, y + size + 1, SIDEBAR);
			g.fill(x + size - 4, y + size - 4, x + size, y + size, statusColor(status));
		}
	}

	static int statusColor(CrewProtocol.Status s) {
		return switch (s) {
			case WORKING -> 0xFF5AA9FF;
			case WAITING -> WARN;
			case ERROR -> BAD;
			case IDLE -> 0xFF6E6880;
		};
	}

	// The chat is rebuilt every frame; wrapping and trimming long messages each time made the screen crawl.
	private final java.util.Map<String, List<FormattedCharSequence>> wrapCache = new java.util.HashMap<>();
	private final java.util.Map<String, String> trimCache = new java.util.HashMap<>();

	private List<FormattedCharSequence> wrap(String text, int w, int color) {
		if (wrapCache.size() > 600) wrapCache.clear();
		return wrapCache.computeIfAbsent(w + ":" + color + ":" + text, k -> font.split(Component.literal(text).withColor(color), Math.max(20, w)));
	}

	private static void dot(GuiGraphicsExtractor g, int x, int y, int color) {
		g.fill(x, y, x + 4, y + 4, color);
	}

	// ---------------------------------------------------------------- frame

	// Minecraft calls this outside our zoom, so it only dims the world; the panel is drawn in drawPanel.
	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float partial) {
		g.fill(0, 0, width, height, 0x99000000);
	}

	private void drawPanel(GuiGraphicsExtractor g) {
		round(g, x0 - 1, y0 - 1, x1 + 1, y1 + 1, 0xFF3B2A5E);
		round(g, x0, y0, x1, y1, BG);
		g.fill(x0 + 1, y0 + 1, chatX0, y1 - 1, SIDEBAR);
		g.fill(chatX0, y0 + 1, chatX0 + 1, y1 - 1, LINE);
		g.fill(chatX0 + 1, y0 + 1, x1 - 1, y1 - 1, CHAT);
		round(g, chatX0 + PAD, y1 - PAD - INPUT, x1 - PAD, y1 - PAD, input != null && input.isFocused() ? 0xFF5A44A0 : LINE);
		round(g, chatX0 + PAD + 1, y1 - PAD - INPUT + 1, x1 - PAD - 1, y1 - PAD - 1, 0xFF181226);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int rawX, int rawY, float partial) {
		int mx = (int) (rawX / k), my = (int) (rawY / k);
		mouseX = mx;
		mouseY = my;
		hits.clear();
		rows.clear();
		g.pose().pushMatrix();
		g.pose().scale(k, k);
		drawPanel(g);
		super.extractRenderState(g, mx, my, partial);
		drawSidebar(g);
		drawHeader(g);
		drawConversation(g);
		drawSendButton(g);
		drawMentions(g);
		drawSuggestions(g);
		drawInputTools(g);
		if (input.getValue().isEmpty()) g.text(font, trim(placeholder(), input.getWidth() - 8), input.getX() + 6, input.getY(), FAINT, shadow);
		drawToast(g);
		drawGhostMenu(g);
		g.pose().popMatrix();
	}

	private void drawSidebar(GuiGraphicsExtractor g) {
		int x = x0 + 10, y = y0 + 10;
		avatar(g, x, y, 12, "Planner", null);
		g.text(font, "Haunted Crew", x + 17, y + 2, PUMPKIN, shadow);
		y += 22;

		int bx1 = chatX0 - 10;
		boolean canNew = ClientConsole.canCommand;
		boolean hot = canNew && hover(x, y, bx1, y + 18);
		round(g, x, y, bx1, y + 18, !canNew ? 0xFF2A2338 : hot ? ACCENT_HI : ACCENT);
		g.centeredText(font, "+  New ghost", (x + bx1) / 2, y + 5, canNew ? 0xFFFFFFFF : FAINT);
		if (canNew) hits.add(new Hit(x, y, bx1, y + 18, () -> {
			mode = Mode.NEW_GHOST;
			selected = null;
			input.setValue("");
			setFocused(input);
		}));
		y += 22;
		boolean gameHot = hover(x, y, bx1, y + 16);
		round(g, x, y, bx1, y + 16, gameHot ? 0xFF3A2C58 : CARD);
		g.centeredText(font, "Play Ghost Rush", (x + bx1) / 2, y + 4, gameHot ? PUMPKIN : DIM);
		hits.add(new Hit(x, y, bx1, y + 16, () -> Minecraft.getInstance().gui.setScreen(new GhostRushScreen(this))));
		y += 20;
		boolean wfHot = hover(x, y, bx1, y + 16);
		round(g, x, y, bx1, y + 16, wfHot ? 0xFF3A2C58 : CARD);
		g.centeredText(font, "Workflows", (x + bx1) / 2, y + 4, wfHot ? PUMPKIN : DIM);
		hits.add(new Hit(x, y, bx1, y + 16, () -> Minecraft.getInstance().gui.setScreen(new WorkflowScreen(this))));
		y += 20;
		boolean mgHot = hover(x, y, bx1, y + 16);
		round(g, x, y, bx1, y + 16, mgHot ? 0xFF3A2C58 : CARD);
		g.centeredText(font, "Merges", (x + bx1) / 2, y + 4, mgHot ? PUMPKIN : DIM);
		hits.add(new Hit(x, y, bx1, y + 16, () -> Minecraft.getInstance().gui.setScreen(new MergeScreen(this))));
		y += 24;

		g.text(font, "CHANNELS", x, y, FAINT, shadow);
		y += 11;
		long needYou = ClientConsole.sessions.values().stream().filter(c -> c.status() == CrewProtocol.Status.WAITING).count();
		sideRow(g, x - 4, y, null, "# crew", ClientConsole.sessions.size() + (ClientConsole.sessions.size() == 1 ? " ghost" : " ghosts") + (needYou > 0 ? " · " + needYou + " need you" : ""));
		y += ROW - 4;
		g.text(font, "GHOSTS", x, y + 2, FAINT, shadow);
		y += 13;
		int bottom = y1 - 46, i = 0, shown = 0, total = ClientConsole.sessions.size();
		sideScroll = Math.min(sideScroll, Math.max(0, total - 1));
		if (sideScroll > 0) {
			g.text(font, "↑ " + sideScroll + " more (scroll)", x, y, FAINT, shadow);
			y += 11;
		}
		// Ghosts waiting for you come first, so an approval never hides below the fold.
		List<CrewProtocol.Session> ordered = new ArrayList<>(ClientConsole.sessions.values());
		ordered.sort(java.util.Comparator.comparingInt(c -> c.status() == CrewProtocol.Status.WAITING ? 0 : 1));
		for (CrewProtocol.Session s : ordered) {
			if (i++ < sideScroll) continue;
			if (y + ROW > bottom) {
				g.text(font, "↓ " + (total - sideScroll - shown) + " more (scroll)", x, y + 4, FAINT, shadow);
				break;
			}
			sideRow(g, x - 4, y, s, s.label(), s.activity());
			y += ROW;
			shown++;
		}
		if (ClientConsole.sessions.isEmpty()) g.text(font, "none yet", x, y + 2, FAINT, shadow);

		// Status footer: bridge + Kiro account.
		int fy = y1 - 36;
		g.fill(x0 + 6, fy - 8, chatX0 - 6, fy - 7, mc ? 0xFF555555 : LINE);
		dot(g, x, fy, ClientConsole.connected() ? OK : "not paired".equals(ClientConsole.bridge) ? FAINT : WARN);
		g.text(font, trim("Bridge " + ClientConsole.bridge, side - 26), x + 8, fy - 2, DIM, shadow);
		fy += 14;
		if (ClientConsole.kiro == null) {
			dot(g, x, fy, FAINT);
			g.text(font, "Kiro …", x + 8, fy - 2, DIM, shadow);
		} else if (ClientConsole.kiroReady()) {
			dot(g, x, fy, OK);
			String who = Boolean.TRUE.equals(ClientConsole.kiro.demo()) ? "demo mode" : "signed in";
			g.text(font, trim("Kiro " + who, side - 26), x + 8, fy - 2, DIM, shadow);
		} else {
			dot(g, x, fy, WARN);
			int end = x + 8 + font.width("Kiro ");
			g.text(font, "Kiro", x + 8, fy - 2, DIM, shadow);
			int ew = font.width("sign in ›");
			g.text(font, "sign in ›", end, fy - 2, hover(end, fy - 4, end + ew, fy + 7) ? ACCENT_HI : ACCENT, shadow);
			if (ClientConsole.canCommand) hits.add(new Hit(end, fy - 4, end + ew, fy + 7, () -> ClientConsole.send("kiro_login", null, null, null, null)));
		}
	}

	private void sideRow(GuiGraphicsExtractor g, int x, int y, CrewProtocol.Session s, String title, String sub) {
		String id = s == null ? null : s.id();
		boolean sel = mode == Mode.CHAT && (id == null ? selected == null : id.equals(selected));
		int xe = chatX0 - 6;
		if (sel) {
			round(g, x, y, xe, y + ROW - 4, SELECT);
			g.fill(x, y + 5, x + 2, y + ROW - 9, PUMPKIN);
		} else if (hover(x, y, xe, y + ROW - 4)) {
			round(g, x, y, xe, y + ROW - 4, 0xFF1A1428);
		}
		if (s == null) {
			round(g, x + 6, y + 4, x + 24, y + 22, 0xFF2C2244);
			g.centeredText(font, "#", x + 15, y + 9, DIM);
		} else {
			avatar(g, x + 6, y + 4, 18, s.label(), s.status());
		}
		int tx = x + 30, tw = xe - tx - 4;
		g.text(font, trim(title + (s != null && !s.console() ? " ·" : ""), tw), tx, y + 4, TEXT, shadow);
		g.text(font, trim(sub, tw), tx, y + 15, (s != null && s.status() == CrewProtocol.Status.WAITING) || sub.contains("need you") ? WARN : DIM, shadow);
		if (id != null) rows.add(new Row(x, y, xe, y + ROW - 4, id));
		hits.add(new Hit(x, y, xe, y + ROW - 4, () -> {
			selected = id;
			mode = Mode.CHAT;
			scroll = 0;
		}));
	}

	private void drawGhostMenu(GuiGraphicsExtractor g) {
		if (menuId == null) return;
		CrewProtocol.Session s = ClientConsole.sessions.get(menuId);
		if (s == null) {
			menuId = null;
			return;
		}
		boolean cmd = ClientConsole.canCommand;
		String[] labels = {"Open chat", "Copy name", cmd ? "Stop task" : null, cmd ? "Dismiss ghost" : null};
		int w = 0, n = 0;
		for (String l : labels) if (l != null) { w = Math.max(w, font.width(l)); n++; }
		menuW = w + 20;
		menuH = n * 14 + 6;
		int x = Math.min(menuX, x1 - menuW - 2), y = Math.min(menuY, y1 - menuH - 2);
		menuX = x;
		menuY = y;
		round(g, x, y, x + menuW, y + menuH, SIDEBAR);
		int row = y + 3;
		final String id = menuId;
		for (String l : labels) {
			if (l == null) continue;
			boolean bad = l.startsWith("Dismiss"), hot = hover(x + 2, row, x + menuW - 2, row + 14);
			if (hot) round(g, x + 2, row, x + menuW - 2, row + 14, bad ? 0xFF8F3838 : ACCENT);
			g.text(font, l, x + 9, row + 3, bad && !hot ? BAD : TEXT, shadow);
			hits.add(new Hit(x + 2, row, x + menuW - 2, row + 14, () -> {
				menuId = null;
				switch (l) {
					case "Open chat" -> {
						selected = id;
						mode = Mode.CHAT;
						scroll = 0;
					}
					case "Copy name" -> {
						Minecraft.getInstance().keyboardHandler.setClipboard(s.label());
						toast("Copied " + s.label());
					}
					case "Stop task" -> ClientConsole.send("interrupt", id, null, null, null);
					default -> {
						ClientConsole.send("dismiss", id, null, null, null);
						if (id.equals(selected)) selected = null;
					}
				}
			}));
			row += 14;
		}
	}

	private void drawHeader(GuiGraphicsExtractor g) {
		int x = chatX0 + PAD + 2, y = y0 + 1;
		g.fill(chatX0 + 1, y + HEADER - 1, x1 - 1, y + HEADER, LINE);
		CrewProtocol.Session s = current();
		String title, sub;
		int subColor = DIM;
		if (mode == Mode.PAIR) {
			title = "Pair with a bridge";
			sub = "for Minecraft servers on another machine";
		} else if (mode == Mode.NEW_GHOST) {
			title = "Summon a ghost";
			sub = "each ghost is a Kiro agent with its own desk";
		} else if (s == null) {
			title = "# crew";
			sub = "everything your ghosts are doing";
		} else {
			avatar(g, x, y + 7, 16, s.label(), s.status());
			x += 22;
			title = s.label();
			int pending = 0;
			for (CrewProtocol.Line l : ClientConsole.lines) {
				if (!l.session().equals(s.id())) continue;
				String k = l.kind() == null ? "" : l.kind();
				if (k.equals("prompt")) pending++;
				else if (k.equals("stop") || k.equals("error")) pending = Math.max(0, pending - 1);
			}
			int queued = Math.max(0, pending - 1);
			sub = s.activity() + (queued > 0 ? "  ·  " + queued + " queued" : "") + (s.model() != null ? "  ·  " + s.model() : "") + (s.console() ? "" : "  ·  from Kiro IDE, watch-only");
			subColor = statusColor(s.status());
		}
		g.text(font, title, x, y + 7, TEXT, shadow);
		g.text(font, trim(sub, x1 - x - 90), x, y + 18, subColor, shadow);
	}

	private boolean modelMenu, ctxPanel;
	private int[] toggleRects = new int[8]; // model button, then ring: x0 y0 x1 y1 each
	private int[] panelRect;

	/** Context window by model: Claude models take 1M tokens in Kiro, others are assumed smaller. */
	private static long contextWindow(String model) {
		return model != null && (model.startsWith("claude-") || model.equals("auto")) ? 1_000_000 : 256_000;
	}

	private static String tokensText(long n) {
		return n >= 1_000_000 ? String.format(Locale.ROOT, "%.1fM", n / 1e6) : n >= 1000 ? String.format(Locale.ROOT, "%.1fk", n / 1000.0) : String.valueOf(n);
	}

	/** Rough size of a ghost's conversation (a quarter of the characters we have seen), not real usage. */
	private static long contextTokens(CrewProtocol.Session s) {
		long chars = 0;
		for (CrewProtocol.Line l : ClientConsole.lines) {
			String k = l.kind() == null ? "" : l.kind();
			if (l.session().equals(s.id()) && (k.equals("prompt") || k.equals("message") || k.equals("thought")) && l.text() != null) chars += l.text().length();
		}
		return chars / 4;
	}

	private static String shortModel(String id) {
		if (id == null) return "Model";
		for (String[] m : MODELS) if (m[0].equals(id)) return m[1].split(" ·")[0];
		return id.length() > 14 ? id.substring(0, 14) : id;
	}

	/** Context ring and model picker, left of the send button, like Claude's chat input. */
	private void drawInputTools(GuiGraphicsExtractor g) {
		CrewProtocol.Session s = current();
		if (mode != Mode.CHAT || s == null || !s.console()) {
			modelMenu = false;
			ctxPanel = false;
			return;
		}
		// the wider Stop button replaces Send while a ghost works: keep the model button clear of it
		int by = y1 - PAD - INPUT + 4, right = stopMode() ? x1 - PAD - 4 - (font.width("Stop") + 22) - 6 : x1 - PAD - 32;
		// model button
		String label = shortModel(s.model()) + " ▾";
		int mw = font.width(label) + 14, mx = right - mw;
		boolean idle = s.status() != CrewProtocol.Status.WORKING;
		boolean hot = hover(mx, by, mx + mw, by + 20);
		round(g, mx, by, mx + mw, by + 20, hot && ClientConsole.canCommand ? ACCENT_HI : CARD);
		g.text(font, label, mx + 7, by + 6, idle ? TEXT : FAINT, shadow);
		hits.add(new Hit(mx, by, mx + mw, by + 20, () -> {
			if (!ClientConsole.canCommand) return;
			if (!idle) toast("Wait for " + s.label() + " to finish before switching model");
			else {
				modelMenu = !modelMenu;
				ctxPanel = false;
			}
		}));
		// context ring (click for context size and plan credits)
		long tokens = contextTokens(s), window = contextWindow(s.model());
		double pct = Math.min(1.0, (double) tokens / window);
		int cx = mx - 16, cy = by + 10, r = 7;
		int fill = pct > 0.85 ? BAD : pct > 0.6 ? WARN : OK;
		for (int dy = -r; dy <= r; dy++) {
			for (int dx = -r; dx <= r; dx++) {
				int d = Math.max(Math.abs(dx), Math.abs(dy)); // square ring, 2 px thick
				if (d > r || d < r - 1) continue;
				double f = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
				g.fill(cx + dx, cy + dy, cx + dx + 1, cy + dy + 1, f <= pct && pct > 0 ? fill : (mc ? 0xFF3A3A3A : 0xFF2A2140));
			}
		}
		toggleRects = new int[] {mx, by, mx + mw, by + 20, cx - r - 2, cy - r - 2, cx + r + 3, cy + r + 3};
		hits.add(new Hit(cx - r - 2, cy - r - 2, cx + r + 3, cy + r + 3, () -> {
			ctxPanel = !ctxPanel;
			modelMenu = false;
			if (ctxPanel && ClientConsole.canCommand) ClientConsole.send("kiro_usage", null, null, null, null);
		}));
		panelRect = null;
		if (ctxPanel) {
			List<String> rows = new ArrayList<>();
			rows.add("Context  ~" + tokensText(tokens) + " of " + tokensText(window) + " (" + Math.round(pct * 100) + "%)");
			String credits = "Credits  loading…";
			String plan = null;
			if (ClientConsole.usage != null) {
				try {
					com.google.gson.JsonObject u = com.google.gson.JsonParser.parseString(ClientConsole.usage).getAsJsonObject();
					if (u.has("error")) credits = "Credits  " + u.get("error").getAsString();
					else if (u.has("used")) {
						double used = u.get("used").getAsDouble(), total = u.get("total").getAsDouble();
						credits = "Credits  " + String.format(Locale.ROOT, "%.0f left of %.0f", Math.max(0, total - used), total) + " (" + Math.round(u.get("percent").getAsDouble()) + "% used)";
						String p = u.has("plan") && !u.get("plan").isJsonNull() ? u.get("plan").getAsString() : null;
						String rs = u.has("resets") && !u.get("resets").isJsonNull() ? u.get("resets").getAsString() : null;
						plan = (p != null ? "Plan " + p : "") + (rs != null ? (p != null ? "  ·  " : "") + "resets " + rs : "");
						if (Boolean.TRUE.equals(u.has("demo") ? u.get("demo").getAsBoolean() : null)) plan = "demo mode: example numbers";
					}
				} catch (RuntimeException ignored) {
					credits = "Credits  unavailable";
				}
			}
			rows.add(credits);
			if (plan != null && !plan.isBlank()) rows.add(plan);
			int w = 0;
			for (String row : rows) w = Math.max(w, font.width(row));
			w += 16;
			int h = rows.size() * 13 + 8, px = Math.min(cx - 10, x1 - PAD - w), yb = by - 4, yt = yb - h;
			round(g, px, yt, px + w, yb, CARD);
			int ty = yt + 5;
			for (int i = 0; i < rows.size(); i++) {
				g.text(font, rows.get(i), px + 8, ty, i == 0 ? TEXT : i == 1 ? WARN : FAINT, shadow);
				ty += 13;
			}
			panelRect = new int[] {px, yt, px + w, yb};
		}
		// model menu
		if (modelMenu) {
			int rows = MODELS.length, w = 190, h = rows * 16 + 6, mxl = Math.min(mx, x1 - PAD - w), yb = by - 4, yt = yb - h;
			round(g, mxl, yt, mxl + w, yb, CARD);
			panelRect = new int[] {mxl, yt, mxl + w, yb};
			for (int i = 0; i < rows; i++) {
				int ry = yt + 3 + i * 16;
				boolean cur = MODELS[i][0].equals(s.model()), over = hover(mxl + 2, ry, mxl + w - 2, ry + 16);
				if (over || cur) round(g, mxl + 2, ry, mxl + w - 2, ry + 16, SELECT);
				g.text(font, (cur ? "✓ " : "  ") + MODELS[i][1], mxl + 6, ry + 4, over || cur ? TEXT : DIM, shadow);
				final String id = MODELS[i][0];
				hits.add(new Hit(mxl + 2, ry, mxl + w - 2, ry + 16, () -> {
					modelMenu = false;
					if (!id.equals(s.model())) ClientConsole.send("model", s.id(), id, null, null);
				}));
			}
		}
	}

	/** Like the AI SDK's prompt input: while a ghost is working and the box is empty, the send button becomes Stop. */
	private boolean stopMode() {
		CrewProtocol.Session s = current();
		return mode == Mode.CHAT && s != null && s.console() && ClientConsole.canCommand && s.status() == CrewProtocol.Status.WORKING && input.getValue().isBlank();
	}

	private static final java.util.Map<CrewProtocol.Job, String[]> SUGGESTIONS = new java.util.EnumMap<>(java.util.Map.of(
		CrewProtocol.Job.PLANNER, new String[] {"Plan the next steps", "List the risks", "Split this into tasks"},
		CrewProtocol.Job.CODER, new String[] {"Fix the failing tests", "Explain this codebase", "Refactor the largest file"},
		CrewProtocol.Job.TESTER, new String[] {"Run the tests", "Find untested code", "Add a regression test"},
		CrewProtocol.Job.REVIEWER, new String[] {"Review the latest change", "Look for security issues", "Check for missing tests"},
		CrewProtocol.Job.DOCS, new String[] {"Update the README", "Document the public API", "Write a changelog entry"},
		CrewProtocol.Job.RESEARCHER, new String[] {"Find where login is handled", "Summarize the architecture", "List the dependencies"}));

	/** Quick prompts above the input for an idle, empty chat (the AI SDK's Suggestion row). */
	private boolean suggestionsVisible() {
		CrewProtocol.Session s = current();
		return mode == Mode.CHAT && s != null && s.console() && ClientConsole.canCommand && s.status() == CrewProtocol.Status.IDLE
			&& input.getValue().isEmpty() && mentionMatches().isEmpty() && summonMatches().isEmpty() && !modelMenu && !ctxPanel;
	}

	private void drawSuggestions(GuiGraphicsExtractor g) {
		CrewProtocol.Session s = current();
		if (!suggestionsVisible()) return;
		CrewProtocol.Job job = CrewProtocol.Job.fromName(s.label());
		String[] picks = SUGGESTIONS.getOrDefault(job == null ? CrewProtocol.Job.CODER : job, SUGGESTIONS.get(CrewProtocol.Job.CODER));
		int x = chatX0 + PAD, y = y1 - PAD - INPUT - 22;
		for (String text : picks) {
			int w = font.width(text) + 14;
			if (x + w > x1 - PAD) break;
			boolean hot = hover(x, y, x + w, y + 16);
			round(g, x, y, x + w, y + 16, hot ? ACCENT_HI : CARD);
			g.text(font, text, x + 7, y + 4, hot ? 0xFFFFFFFF : DIM, shadow);
			hits.add(new Hit(x, y, x + w, y + 16, () -> {
				ClientConsole.send("prompt", s.id(), text, null, null);
				scroll = 0;
			}));
			x += w + 6;
		}
	}

	private void drawSendButton(GuiGraphicsExtractor g) {
		int bx = x1 - PAD - 26, by = y1 - PAD - INPUT + 4;
		if (stopMode()) {
			int sw = font.width("Stop") + 22, sx = x1 - PAD - 4 - sw;
			boolean hotStop = hover(sx, by, sx + sw, by + 20);
			round(g, sx, by, sx + sw, by + 20, hotStop ? 0xFFB34747 : 0xFF8F3838);
			g.fill(sx + 6, by + 7, sx + 12, by + 13, 0xFFFFFFFF);
			g.text(font, "Stop", sx + 16, by + 6, 0xFFFFFFFF, shadow);
			String id = current().id();
			hits.add(new Hit(sx, by, sx + sw, by + 20, () -> ClientConsole.send("interrupt", id, null, null, null)));
			return;
		}
		boolean enabled = !input.getValue().isBlank() && (mode == Mode.PAIR || ClientConsole.canCommand);
		boolean hot = enabled && hover(bx, by, bx + 22, by + 20);
		round(g, bx, by, bx + 22, by + 20, !enabled ? 0xFF2A2338 : hot ? ACCENT_HI : ACCENT);
		g.centeredText(font, "➤", bx + 11, by + 6, enabled ? 0xFFFFFFFF : FAINT);
		if (enabled) hits.add(new Hit(bx, by, bx + 22, by + 20, this::submit));
	}

	private void drawToast(GuiGraphicsExtractor g) {
		if (ClientConsole.notice == null || System.currentTimeMillis() - ClientConsole.noticeAt > 6000) return;
		String n = trim(ClientConsole.notice, (x1 - chatX0) / 2);
		int w = font.width(n) + 16, x = x1 - PAD - w, y = y0 + HEADER + 8; // top right of the chat, clear of the input, chips and menus
		round(g, x, y, x + w, y + 16, 0xF02E2346);
		g.text(font, n, x + 8, y + 4, WARN, shadow);
	}

	// ---------------------------------------------------------------- conversation

	private void drawConversation(GuiGraphicsExtractor g) {
		int top = y0 + HEADER + 6, bottom = y1 - PAD - INPUT - 8 - (suggestionsVisible() ? 22 : 0);
		int left = chatX0 + PAD + 4, right = x1 - PAD - 4, width = right - left;
		List<Block> blocks = new ArrayList<>();
		boolean chat = false;
		if (mode == Mode.PAIR) blocks.add(pairCard());
		else if (onboarding()) blocks.add(onboardingCard());
		else if (mode == Mode.NEW_GHOST) blocks.add(summonCard());
		else {
			if (ClientConsole.connected() && ClientConsole.kiro != null && !ClientConsole.kiroReady()) blocks.add(kiroCard(width));
			int before = blocks.size();
			buildMessages(blocks, width);
			chat = blocks.size() > before;
			if (!chat) blocks.add(ClientConsole.sessions.isEmpty() ? summonCard() : emptyHint(width));
		}

		int total = -8;
		for (Block b : blocks) total += b.height + 8;
		int view = bottom - top;
		scroll = Math.min(scroll, Math.max(0, total - view));
		// Chats stick to the bottom like a messenger; cards sit at the top.
		int y = total > view ? bottom - total + scroll : chat ? bottom - total : top;
		g.enableScissor(chatX0 + 1, top, x1 - 1, bottom);
		for (Block b : blocks) {
			if (y + b.height >= top && y <= bottom) b.draw.draw(g, left, y, right);
			y += b.height + 8;
		}
		g.disableScissor();
		if (total > view) {
			int bx = x1 - 6, th = Math.max(16, view * view / total), range = view - th;
			int ty = top + (int) (range * (1.0 - (double) scroll / Math.max(1, total - view)));
			g.fill(bx, top, bx + 3, bottom, mc ? 0xFF000000 : 0xFF181226);
			round(g, bx - 1, ty, bx + 4, ty + th, mc ? 0xFF8B8B8B : ACCENT);
		}
		if (scroll > 0) {
			int cx = (chatX0 + x1) / 2;
			round(g, cx - 34, bottom - 16, cx + 34, bottom - 2, 0xF02E2346);
			g.centeredText(font, "↓ newest", cx, bottom - 12, DIM);
			hits.add(new Hit(cx - 34, bottom - 16, cx + 34, bottom - 2, () -> scroll = 0));
		}
	}

	private void buildMessages(List<Block> out, int width) {
		boolean crew = selected == null;
		List<CrewProtocol.Line> all = new ArrayList<>();
		for (CrewProtocol.Line l : ClientConsole.lines) if (crew || l.session().equals(selected)) all.add(l);
		// Per session: index of its last chat line (prompt / reply / join). Steps after it are the live turn.
		java.util.Map<String, Integer> lastChat = new java.util.HashMap<>();
		for (int i = 0; i < all.size(); i++) if (isChat(all.get(i))) lastChat.put(all.get(i).session(), i);
		java.util.Set<String> liveShown = new java.util.HashSet<>();
		java.util.Map<String, Long> promptAt = new java.util.HashMap<>(); // when each session's current turn began

		String lastSpeaker = null;
		List<CrewProtocol.Line> activity = new ArrayList<>();
		for (int i = 0; i <= all.size(); i++) {
			CrewProtocol.Line l = i < all.size() ? all.get(i) : null;
			if (l != null && !isChat(l) && (activity.isEmpty() || activity.get(0).session().equals(l.session()))) {
				activity.add(l);
				continue;
			}
			if (!activity.isEmpty()) {
				CrewProtocol.Line first = activity.get(0);
				CrewProtocol.Session s = ClientConsole.sessions.get(first.session());
				boolean live = s != null && s.status() != CrewProtocol.Status.IDLE && !"stop".equals(activity.get(activity.size() - 1).kind())
					&& i - activity.size() > lastChat.getOrDefault(first.session(), -1);
				if (live) liveShown.add(first.session());
				// Thinking time: from the prompt (or the first step) to the session's next line after these steps.
				long from = promptAt.getOrDefault(first.session(), first.ts()), to = activity.get(activity.size() - 1).ts();
				for (int j = i; j < all.size(); j++) if (all.get(j).session().equals(first.session())) { to = all.get(j).ts(); break; }
				out.add(isThinking(activity) || live
					? thinkingBlock(new ArrayList<>(activity), first.session(), nameOf(first), width, crew, live, live ? s.thinking() : null, from, to)
					: activityBlock(new ArrayList<>(activity), nameOf(first), width, crew));
				activity.clear();
			}
			if (l == null) break;
			if (!isChat(l)) {
				activity.add(l);
				continue;
			}
			String who = nameOf(l);
			String kind = l.kind() == null ? "" : l.kind();
			if (kind.equals("session_start") || kind.equals("session_end")) {
				out.add(systemBlock(who + " " + l.text(), width));
			} else if (kind.equals("prompt")) {
				promptAt.put(l.session(), l.ts());
				out.add(userBubble(l.text().substring(2), crew ? who : null, width, l.session()));
				lastSpeaker = null;
			} else {
				out.add(agentBubble(l.text(), who, crew || !who.equals(lastSpeaker), width));
				lastSpeaker = who;
			}
		}

		// Live turns: thinking (when no steps yet) and the reply streaming in, then pending approvals.
		List<String> working = new ArrayList<>();
		for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
			if (!crew && !s.id().equals(selected)) continue;
			boolean busy = s.status() == CrewProtocol.Status.WORKING;
			if (s.console() && busy && !liveShown.contains(s.id()) && s.draft() == null) {
				out.add(thinkingBlock(List.of(), s.id(), s.label(), width, crew, true, s.thinking(), promptAt.getOrDefault(s.id(), 0L), 0));
			} else if (busy && !s.console()) {
				working.add(s.label());
			}
			if (s.draft() != null) out.add(agentBubble(s.draft() + ((ticks / 8) % 2 == 0 ? " ▍" : ""), s.label(), true, width));
		}
		for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
			if ((crew || s.id().equals(selected)) && s.permission() != null) out.add(approvalCard(s, width));
		}
		if (!working.isEmpty()) out.add(typingBlock(working));
	}

	private static boolean isChat(CrewProtocol.Line l) {
		String kind = l.kind() == null ? "" : l.kind();
		return (kind.equals("prompt") && l.text().startsWith("▶ ")) || kind.equals("message") || kind.equals("session_start") || kind.equals("session_end");
	}

	/** Steps worth folding into a "Thought for Ns" block (not a lone "finished"). */
	private static boolean isThinking(List<CrewProtocol.Line> lines) {
		for (CrewProtocol.Line l : lines) {
			String k = l.kind() == null ? "" : l.kind();
			if (k.equals("thought") || k.startsWith("tool_") || k.startsWith("permission") || k.startsWith("file_")) return true;
		}
		return false;
	}

	/**
	 * Claude-style thinking: "✻ Thinking… 4s" with the steps and thoughts while the agent works,
	 * then a collapsed "✻ Thought for 12s · 5 steps ›" that opens on click.
	 */
	private Block thinkingBlock(List<CrewProtocol.Line> lines, String session, String who, int width, boolean crew, boolean live, String thinking, long start, long end) {
		String key = session + "@" + (lines.isEmpty() ? 0 : lines.get(0).ts());
		boolean open = live || expanded.contains(key);
		int steps = 0;
		for (CrewProtocol.Line l : lines) if (!"thought".equals(l.kind()) && !"tool_end".equals(l.kind())) steps++;
		List<FormattedCharSequence> rows = new ArrayList<>();
		List<Integer> colors = new ArrayList<>();
		int hidden = 0;
		if (open) {
			List<CrewProtocol.Line> show = live && lines.size() > 8 ? lines.subList(lines.size() - 8, lines.size()) : lines;
			hidden = lines.size() - show.size();
			for (CrewProtocol.Line l : show) {
				boolean thought = "thought".equals(l.kind());
				String t = thought ? l.text().replace('\n', ' ') : activityIcon(l.kind(), l.text()) + "  " + l.text();
				int c = thought ? FAINT : activityColor(l.kind(), l.text());
				for (FormattedCharSequence r : wrap(t, width - 44, c)) {
					rows.add(r);
					colors.add(c);
				}
			}
			if (thinking != null) {
				List<FormattedCharSequence> t = wrap(thinking.replace('\n', ' '), width - 44, FAINT);
				for (FormattedCharSequence r : t.subList(Math.max(0, t.size() - 4), t.size())) {
					rows.add(r);
					colors.add(FAINT);
				}
			}
		}
		int head = crew ? 11 : 0, extra = hidden > 0 ? 10 : 0, body = rows.size() * 10 + extra;
		final int hiddenF = hidden, stepsF = steps;
		return new Block(head + 12 + (body > 0 ? body + 2 : 0), (g, left, y, right) -> {
			int x = left + 24;
			if (crew) g.text(font, who, x, y, nameColor(who), shadow);
			int hy = y + head;
			int star = live ? ((ticks / 5) % 2 == 0 ? PUMPKIN : ACCENT_HI) : FAINT;
			g.text(font, "✻", x, hy + 1, star, shadow);
			long secs = Math.max(1, ((live ? System.currentTimeMillis() : end) - (start == 0 ? System.currentTimeMillis() : start)) / 1000);
			String label = live ? "Thinking… " + secs + "s" : "Thought for " + secs + "s" + (stepsF > 0 ? "  ·  " + stepsF + (stepsF == 1 ? " step" : " steps") : "") + (open ? "  ˅" : "  ›");
			int lw = font.width(label);
			boolean hot = !live && hover(x, hy, x + 12 + lw, hy + 11);
			g.text(font, label, x + 11, hy + 1, live ? DIM : hot ? TEXT : FAINT, shadow);
			if (!live) hits.add(new Hit(x, hy, x + 12 + lw, hy + 11, () -> {
				if (!expanded.remove(key)) expanded.add(key);
			}));
			if (body == 0) return;
			int ty = hy + 13;
			g.fill(x + 3, ty, x + 4, ty + body - 1, LINE);
			if (hiddenF > 0) {
				g.text(font, "… " + hiddenF + " earlier", x + 10, ty, FAINT, shadow);
				ty += 10;
			}
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 10, ty, DIM, shadow);
				ty += 10;
			}
		});
	}

	private String nameOf(CrewProtocol.Line l) {
		if (l.agent() != null) return l.agent();
		CrewProtocol.Session s = ClientConsole.sessions.get(l.session());
		return s != null ? s.label() : "Ghost";
	}

	/** Hover chips on a bubble, like the AI SDK's message actions: Copy, and Retry (resend) on your own messages. */
	private void bubbleActions(GuiGraphicsExtractor g, int bx0, int by0, int bx1, int by1, String text, String retrySession) {
		if (!hover(bx0, by0 - 20, bx1, by1)) return;
		List<String> names = new ArrayList<>(List.of("Copy"));
		if (retrySession != null && ClientConsole.canCommand && ClientConsole.sessions.containsKey(retrySession) && !text.endsWith("…")) names.add("Retry");
		int x = bx1;
		for (int i = names.size() - 1; i >= 0; i--) {
			String name = names.get(i);
			int w = font.width(name) + 12;
			x -= w + 3;
			boolean hot = hover(x, by0 - 18, x + w, by0 - 2);
			round(g, x, by0 - 18, x + w, by0 - 2, hot ? ACCENT_HI : CARD);
			g.text(font, name, x + 6, by0 - 14, hot ? 0xFFFFFFFF : DIM, shadow);
			hits.add(new Hit(x, by0 - 18, x + w, by0 - 2, () -> {
				if (name.equals("Copy")) {
					Minecraft.getInstance().keyboardHandler.setClipboard(text);
					toast("Copied");
				} else {
					ClientConsole.send("prompt", retrySession, text, null, null);
					scroll = 0;
				}
			}));
		}
	}

	private Block userBubble(String text, String to, int width, String session) {
		int max = (int) (width * 0.72);
		List<FormattedCharSequence> rows = wrap(text, max - 16, 0xFFFFFFFF);
		int w = 16;
		for (FormattedCharSequence r : rows) w = Math.max(w, font.width(r) + 16);
		int label = to != null ? 11 : 0, fw = w, bh = rows.size() * 10 + 10;
		return new Block(bh + label, (g, left, y, right) -> {
			if (to != null) g.text(font, "you → " + to, right - font.width("you → " + to), y, FAINT, shadow);
			int by = y + label;
			round(g, right - fw, by, right, by + bh, USER_BUBBLE);
			int ty = by + 5;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, right - fw + 8, ty, 0xFFFFFFFF, shadow);
				ty += 10;
			}
			bubbleActions(g, right - fw, by, right, by + bh, text, session);
		});
	}

	/** Kiro replies in markdown; show it as plain chat text: bullets, no ** or backticks, real line breaks. */
	static List<String> markdownLines(String text) {
		List<String> out = new ArrayList<>();
		for (String raw : text.split("\n")) {
			String line = raw.strip();
			line = line.replaceAll("^#{1,6}\\s+", "").replaceAll("^[-*]\\s+", "• ").replace("**", "").replace("__", "").replace("`", "");
			if (line.isEmpty() && (out.isEmpty() || out.get(out.size() - 1).isEmpty())) continue;
			out.add(line);
		}
		while (!out.isEmpty() && out.get(out.size() - 1).isEmpty()) out.remove(out.size() - 1);
		return out;
	}

	private Block agentBubble(String text, String who, boolean showName, int width) {
		int max = (int) (width * 0.78) - 24;
		List<FormattedCharSequence> rows = new ArrayList<>();
		for (String line : markdownLines(text)) {
			if (line.isEmpty()) rows.add(FormattedCharSequence.EMPTY);
			else rows.addAll(wrap(line, max - 16, TEXT));
		}
		int w = 16;
		for (FormattedCharSequence r : rows) w = Math.max(w, font.width(r) + 16);
		int label = showName ? 12 : 0, fw = w, bh = rows.size() * 10 + 10;
		return new Block(bh + label, (g, left, y, right) -> {
			if (showName) {
				avatar(g, left, y, 16, who, null);
				g.text(font, who, left + 24, y + 1, nameColor(who), shadow);
			}
			int by = y + label, bx = left + 24;
			round(g, bx, by, bx + fw, by + bh, AGENT_BUBBLE);
			int ty = by + 5;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, bx + 8, ty, TEXT, shadow);
				ty += 10;
			}
			bubbleActions(g, bx, by, bx + fw, by + bh, String.join("\n", markdownLines(text)), null);
		});
	}

	private Block activityBlock(List<CrewProtocol.Line> lines, String who, int width, boolean crew) {
		// The last 6 steps; older ones collapse into a counter.
		int hidden = Math.max(0, lines.size() - 6);
		List<FormattedCharSequence> rows = new ArrayList<>();
		for (CrewProtocol.Line l : lines.subList(hidden, lines.size())) {
			rows.addAll(wrap(activityIcon(l.kind(), l.text()) + "  " + l.text(), width - 40, activityColor(l.kind(), l.text())));
		}
		int head = crew ? 11 : 0, extra = hidden > 0 ? 10 : 0;
		return new Block(head + extra + rows.size() * 10, (g, left, y, right) -> {
			int x = left + 24;
			if (crew) g.text(font, who, x, y, nameColor(who), shadow);
			int ty = y + head;
			g.fill(x, ty, x + 1, ty + extra + rows.size() * 10 - 1, LINE);
			if (hidden > 0) {
				g.text(font, "… " + hidden + " earlier steps", x + 7, ty, FAINT, shadow);
				ty += 10;
			}
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 7, ty, DIM, shadow);
				ty += 10;
			}
		});
	}

	private static String activityIcon(String kind, String text) {
		if (kind == null) return "•";
		return switch (kind) {
			case "tool_end", "error" -> "✖";
			case "permission" -> "⚠";
			case "permission_resolved" -> text.contains("approved") ? "✔" : "✖";
			case "stop", "task_end" -> "✔";
			case "file_create", "file_save", "file_delete" -> "✎";
			case "task_start" -> "▸";
			default -> text.startsWith("reading") ? "◦" : text.startsWith("writing") ? "✎" : text.startsWith("running") ? "›" : "•";
		};
	}

	private static int activityColor(String kind, String text) {
		if (kind == null) return DIM;
		return switch (kind) {
			case "tool_end", "error" -> BAD;
			case "permission" -> WARN;
			case "stop", "task_end" -> OK;
			case "permission_resolved" -> text.contains("approved") ? OK : BAD;
			default -> DIM;
		};
	}

	private Block systemBlock(String text, int width) {
		return new Block(10, (g, left, y, right) -> g.centeredText(font, trim(text, width), (left + right) / 2, y, FAINT));
	}

	private Block typingBlock(List<String> names) {
		String who = names.size() == 1 ? names.get(0) + " is working"
			: names.size() == 2 ? names.get(0) + " and " + names.get(1) + " are working" : names.size() + " ghosts are working";
		return new Block(12, (g, left, y, right) -> {
			int x = left + 24;
			g.text(font, who, x, y + 2, FAINT, shadow);
			int dx = x + font.width(who) + 5;
			for (int i = 0; i < 3; i++) {
				boolean on = (ticks / 6) % 3 == i;
				g.fill(dx + i * 5, y + 6, dx + i * 5 + 3, y + 9, on ? ACCENT_HI : 0xFF4A3F66);
			}
		});
	}

	private Block approvalCard(CrewProtocol.Session s, int width) {
		CrewProtocol.Permission p = s.permission();
		int cw = Math.min(width - 24, 320);
		List<FormattedCharSequence> rows = wrap(s.label() + " wants to: " + p.title(), cw - 16, TEXT);
		int h = 18 + rows.size() * 10 + 24;
		return new Block(h, (g, left, y, right) -> {
			int x = left + 24, xe = x + cw;
			round(g, x, y, xe, y + h, 0xFFB8862A);
			round(g, x + 1, y + 1, xe - 1, y + h - 1, 0xFF241C10);
			g.text(font, "⚠  Needs your approval", x + 8, y + 6, WARN, shadow);
			int ty = y + 18;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 8, ty, TEXT, shadow);
				ty += 10;
			}
			if (!ClientConsole.canCommand) {
				g.text(font, "Only the world owner or an operator can answer.", x + 8, ty + 6, DIM, shadow);
				return;
			}
			int bx = x + 8;
			List<CrewProtocol.Option> opts = p.options().isEmpty() ? List.of(new CrewProtocol.Option(null, "Deny")) : p.options();
			for (CrewProtocol.Option o : opts) {
				boolean allow = o.id() != null && o.id().toLowerCase(Locale.ROOT).contains("allow");
				bx = button(g, bx, ty + 4, o.name(), allow ? 0xFF2F8F4E : 0xFF8F2F3A, () -> ClientConsole.send("permission", s.id(), null, p.id(), o.id())) + 6;
			}
		});
	}

	private Block emptyHint(int width) {
		CrewProtocol.Session s = current();
		String text = s == null ? "Pick a ghost on the left, or message one here with @Name."
			: s.console() ? "Say hi to " + s.label() + ". Try: read the README and summarise it."
			: s.label() + "'s work in Kiro IDE will show up here.";
		return new Block(20, (g, left, y, right) -> g.centeredText(font, trim(text, width), (left + right) / 2, y + 6, FAINT));
	}

	private Block summonCard() {
		String[] jobs = {"Planner", "Coder", "Tester", "Reviewer", "Docs", "Researcher"};
		return new Block(122, (g, left, y, right) -> {
			int cx = (left + right) / 2;
			avatar(g, cx - 12, y + 4, 24, "Planner", null);
			g.centeredText(font, ClientConsole.sessions.isEmpty() ? "Summon your first ghost" : "Summon another ghost", cx, y + 36, TEXT);
			g.centeredText(font, ClientConsole.canCommand ? "Pick a job, or type any name below" : "Ask the world owner to summon ghosts", cx, y + 48, DIM);
			if (!ClientConsole.canCommand) return;
			int rowW = 0;
			for (String j : jobs) rowW += font.width(j) + 20;
			int startX = Math.max(left, cx - rowW / 2), bx = startX, by = y + 64;
			for (String j : jobs) {
				if (bx + font.width(j) + 14 > right) {
					bx = startX;
					by += 20;
				}
				bx = button(g, bx, by, j, jobColor(j), () -> summon(j)) + 6;
			}
			String m = "Model: " + MODELS[modelIndex][1] + "  ⟳";
			int mw = font.width(m) + 16, mx = cx - mw / 2, my = by + 24;
			boolean hot = hover(mx, my, mx + mw, my + 16);
			round(g, mx, my, mx + mw, my + 16, hot ? 0xFF3A2C58 : CARD);
			g.text(font, m, mx + 8, my + 4, hot ? TEXT : DIM, shadow);
			hits.add(new Hit(mx, my, mx + mw, my + 16, () -> modelIndex = (modelIndex + 1) % MODELS.length));
		});
	}

	private Block kiroCard(int width) {
		boolean notInstalled = Boolean.FALSE.equals(ClientConsole.kiro.installed());
		boolean inProgress = ClientConsole.loginCode != null || ClientConsole.loginUrl != null;
		int h = inProgress ? 66 : 42;
		return new Block(h, (g, left, y, right) -> {
			round(g, left, y, right, y + h, 0xFF3B2A5E);
			round(g, left + 1, y + 1, right - 1, y + h - 1, CARD);
			int x = left + 10;
			if (notInstalled) {
				g.text(font, "Kiro CLI isn't installed on the bridge PC", x, y + 8, WARN, shadow);
				g.text(font, trim("Install it from kiro.dev/downloads, or restart the launcher with --demo.", width - 20), x, y + 22, DIM, shadow);
				return;
			}
			if (!inProgress) {
				int textW = width - font.width("Sign in") - 40;
				g.text(font, trim("Sign in to Kiro so your ghosts can work", textW), x, y + 8, TEXT, shadow);
				g.text(font, trim("Opens Kiro's own sign-in. No passwords here.", textW), x, y + 22, DIM, shadow);
				if (ClientConsole.canCommand) button(g, right - font.width("Sign in") - 24, y + 13, "Sign in", ACCENT, () -> ClientConsole.send("kiro_login", null, null, null, null));
				return;
			}
			g.text(font, "Finish signing in to Kiro in your browser", x, y + 8, TEXT, shadow);
			if (ClientConsole.loginCode != null) {
				g.text(font, "Code:", x, y + 23, DIM, shadow);
				g.text(font, ClientConsole.loginCode, x + 34, y + 23, PUMPKIN, shadow);
			} else if (!ClientConsole.loginLines.isEmpty()) {
				g.text(font, trim(ClientConsole.loginLines.get(ClientConsole.loginLines.size() - 1), width - 20), x, y + 23, DIM, shadow);
			}
			int bx = x;
			if (ClientConsole.loginUrl != null) {
				URI uri = URI.create(ClientConsole.loginUrl);
				bx = button(g, bx, y + 40, "Open sign-in page", ACCENT, () -> ConfirmLinkScreen.confirmLinkNow(this, uri)) + 8;
			}
			g.text(font, "waiting" + ".".repeat(1 + (ticks / 10) % 3), bx, y + 44, FAINT, shadow);
		}, true);
	}

	private Block onboardingCard() {
		return new Block(150, (g, left, y, right) -> {
			int cx = (left + right) / 2;
			avatar(g, cx - 12, y + 4, 24, "Planner", null);
			g.centeredText(font, "Connect your crew", cx, y + 36, TEXT);
			g.centeredText(font, "Two minutes. No passwords, no copying keys.", cx, y + 48, DIM);
			int x = left + Math.max(10, (right - left - 320) / 2), sy = y + 70;
			step(g, x, sy, "1", "On the PC with your project, run:");
			round(g, x + 18, sy + 12, x + 18 + font.width("npx haunted-crew") + 12, sy + 26, 0xFF241B38);
			g.text(font, "npx haunted-crew", x + 24, sy + 15, PUMPKIN, shadow);
			button(g, x + 18 + font.width("npx haunted-crew") + 18, sy + 11, "Copy prompt", ACCENT, () -> {
				Minecraft.getInstance().keyboardHandler.setClipboard(TutorialScreen.INSTALL_PROMPT);
				toast("Copied. Paste it into your AI tool");
			});
			g.text(font, trim("Same PC? That's it, this screen updates itself.", right - x - 20), x + 18, sy + 30, DIM, shadow);
			step(g, x, sy + 50, "2", "Server on another machine?");
			button(g, x + 18, sy + 62, "Enter pairing code", ACCENT, () -> {
				mode = Mode.PAIR;
				input.setValue("");
				setFocused(input);
			});
		});
	}

	private void step(GuiGraphicsExtractor g, int x, int y, String n, String text) {
		round(g, x, y - 2, x + 12, y + 10, ACCENT);
		g.centeredText(font, n, x + 6, y, 0xFFFFFFFF);
		g.text(font, text, x + 18, y, TEXT, shadow);
	}

	private Block pairCard() {
		return new Block(56, (g, left, y, right) -> {
			int cx = (left + right) / 2;
			g.centeredText(font, "Type the code the launcher printed, then the bridge address:", cx, y + 6, TEXT);
			g.centeredText(font, "HC-XXXX-XXXX  ws://that-pc:8787/stream", cx, y + 20, PUMPKIN);
			g.centeredText(font, "Each code works once, for 10 minutes. Esc to go back.", cx, y + 36, DIM);
		});
	}

	// ---------------------------------------------------------------- text helpers

	private String trim(String s, int maxW) {
		if (s == null) return "";
		if (trimCache.size() > 600) trimCache.clear();
		return trimCache.computeIfAbsent(maxW + ":" + s, k -> {
			if (font.width(s) <= maxW) return s;
			int lo = 1, hi = s.length(); // longest prefix that still fits with the ellipsis
			while (lo < hi) {
				int mid = (lo + hi + 1) >>> 1;
				if (font.width(s.substring(0, mid) + "…") <= maxW) lo = mid;
				else hi = mid - 1;
			}
			return s.substring(0, lo) + "…";
		});
	}

	private static int nameColor(String name) {
		int[] palette = {0xFF9CC4FF, 0xFFFFC08A, 0xFFA6EBA0, 0xFFF0A8E8, 0xFF8AEBDF, 0xFFFFE38A, 0xFFCDB4FF};
		return palette[Math.floorMod(name.hashCode(), palette.length)];
	}
}
