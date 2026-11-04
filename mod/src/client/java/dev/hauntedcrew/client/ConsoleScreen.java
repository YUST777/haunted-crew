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
	private static final int BG = 0xF00E0A16, SIDEBAR = 0xFF140F1F, CHAT = 0xFF100C19, LINE = 0xFF2A2140;
	private static final int TEXT = 0xFFECE8F4, DIM = 0xFF8E84A6, FAINT = 0xFF5E5675;
	private static final int ACCENT = 0xFF8B5CF6, ACCENT_HI = 0xFFA078FF, PUMPKIN = 0xFFFF9A3C;
	private static final int USER_BUBBLE = 0xFF6D45D8, AGENT_BUBBLE = 0xFF221A33, CARD = 0xFF1B1429;
	private static final int OK = 0xFF4ADE80, WARN = 0xFFFFC94D, BAD = 0xFFFF6B6B, SELECT = 0xFF241B38;
	private static final int ROW = 30, HEADER = 30, INPUT = 28, PAD = 10;

	private enum Mode { CHAT, NEW_GHOST, PAIR }

	private record Hit(int x0, int y0, int x1, int y1, Runnable action) {}

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
		input = new EditBox(font, ix, iy, x1 - PAD - 34 - ix, 12, Component.translatable("screen.hauntedcrew.console.input"));
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
						pendingSelect = null;
						scroll = 0;
						break;
					}
				}
			}
			if (selected != null && current() == null) selected = null;
		}
		// While a Kiro sign-in is open in the browser, check every 3 s whether it finished.
		if (ClientConsole.loginCode != null && ticks % 60 == 0) ClientConsole.send("kiro_status", null, null, null, null);
		refreshInput();
	}

	// ---------------------------------------------------------------- input

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
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

	private static void round(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int color) {
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
		g.text(font, label, x + 7, y + 4, 0xFFFFFFFF, false);
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

	private List<FormattedCharSequence> wrap(String text, int w, int color) {
		return font.split(Component.literal(text).withColor(color), Math.max(20, w));
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
		g.pose().pushMatrix();
		g.pose().scale(k, k);
		drawPanel(g);
		super.extractRenderState(g, mx, my, partial);
		drawSidebar(g);
		drawHeader(g);
		drawConversation(g);
		drawSendButton(g);
		if (input.getValue().isEmpty()) g.text(font, trim(placeholder(), input.getWidth() - 8), input.getX() + 6, input.getY(), FAINT, false);
		drawToast(g);
		g.pose().popMatrix();
	}

	private void drawSidebar(GuiGraphicsExtractor g) {
		int x = x0 + 10, y = y0 + 10;
		avatar(g, x, y, 12, "Planner", null);
		g.text(font, "Haunted Crew", x + 17, y + 2, PUMPKIN, false);
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
		y += 24;

		g.text(font, "CHANNELS", x, y, FAINT, false);
		y += 11;
		sideRow(g, x - 4, y, null, "# crew", ClientConsole.sessions.size() + (ClientConsole.sessions.size() == 1 ? " ghost" : " ghosts"));
		y += ROW - 4;
		g.text(font, "GHOSTS", x, y + 2, FAINT, false);
		y += 13;
		int bottom = y1 - 46, i = 0, shown = 0, total = ClientConsole.sessions.size();
		sideScroll = Math.min(sideScroll, Math.max(0, total - 1));
		if (sideScroll > 0) {
			g.text(font, "↑ " + sideScroll + " more (scroll)", x, y, FAINT, false);
			y += 11;
		}
		for (CrewProtocol.Session s : ClientConsole.sessions.values()) {
			if (i++ < sideScroll) continue;
			if (y + ROW > bottom) {
				g.text(font, "↓ " + (total - sideScroll - shown) + " more (scroll)", x, y + 4, FAINT, false);
				break;
			}
			sideRow(g, x - 4, y, s, s.label(), s.activity());
			y += ROW;
			shown++;
		}
		if (ClientConsole.sessions.isEmpty()) g.text(font, "none yet", x, y + 2, FAINT, false);

		// Status footer: bridge + Kiro account.
		int fy = y1 - 36;
		g.fill(x0 + 6, fy - 8, chatX0 - 6, fy - 7, LINE);
		dot(g, x, fy, ClientConsole.connected() ? OK : "not paired".equals(ClientConsole.bridge) ? FAINT : WARN);
		g.text(font, trim("Bridge " + ClientConsole.bridge, side - 26), x + 8, fy - 2, DIM, false);
		fy += 14;
		if (ClientConsole.kiro == null) {
			dot(g, x, fy, FAINT);
			g.text(font, "Kiro …", x + 8, fy - 2, DIM, false);
		} else if (ClientConsole.kiroReady()) {
			dot(g, x, fy, OK);
			String who = Boolean.TRUE.equals(ClientConsole.kiro.demo()) ? "demo mode" : "signed in";
			g.text(font, trim("Kiro " + who, side - 26), x + 8, fy - 2, DIM, false);
		} else {
			dot(g, x, fy, WARN);
			int end = x + 8 + font.width("Kiro ");
			g.text(font, "Kiro", x + 8, fy - 2, DIM, false);
			int ew = font.width("sign in ›");
			g.text(font, "sign in ›", end, fy - 2, hover(end, fy - 4, end + ew, fy + 7) ? ACCENT_HI : ACCENT, false);
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
		g.text(font, trim(title + (s != null && !s.console() ? " ·" : ""), tw), tx, y + 4, TEXT, false);
		g.text(font, trim(sub, tw), tx, y + 15, s != null && s.status() == CrewProtocol.Status.WAITING ? WARN : DIM, false);
		hits.add(new Hit(x, y, xe, y + ROW - 4, () -> {
			selected = id;
			mode = Mode.CHAT;
			scroll = 0;
		}));
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
			sub = s.activity() + (s.model() != null ? "  ·  " + s.model() : "") + (s.console() ? "" : "  ·  from Kiro IDE, watch-only");
			subColor = statusColor(s.status());
		}
		g.text(font, title, x, y + 7, TEXT, false);
		g.text(font, trim(sub, x1 - x - 90), x, y + 18, subColor, false);
		String role = ClientConsole.canCommand ? "commander" : "watching";
		int rw = font.width(role) + 12;
		round(g, x1 - PAD - rw, y + 9, x1 - PAD, y + 21, ClientConsole.canCommand ? 0xFF3A2A12 : 0xFF2A2338);
		g.text(font, role, x1 - PAD - rw + 6, y + 11, ClientConsole.canCommand ? PUMPKIN : DIM, false);
	}

	private void drawSendButton(GuiGraphicsExtractor g) {
		int bx = x1 - PAD - 26, by = y1 - PAD - INPUT + 4;
		boolean enabled = !input.getValue().isBlank() && (mode == Mode.PAIR || ClientConsole.canCommand);
		boolean hot = enabled && hover(bx, by, bx + 22, by + 20);
		round(g, bx, by, bx + 22, by + 20, !enabled ? 0xFF2A2338 : hot ? ACCENT_HI : ACCENT);
		g.centeredText(font, "➤", bx + 11, by + 6, enabled ? 0xFFFFFFFF : FAINT);
		if (enabled) hits.add(new Hit(bx, by, bx + 22, by + 20, this::submit));
	}

	private void drawToast(GuiGraphicsExtractor g) {
		if (ClientConsole.notice == null || System.currentTimeMillis() - ClientConsole.noticeAt > 6000) return;
		String n = trim(ClientConsole.notice, x1 - chatX0 - 40);
		int w = font.width(n) + 16, cx = (chatX0 + x1) / 2, y = y1 - PAD - INPUT - 22; // just above the input, never over cards
		round(g, cx - w / 2, y, cx + w / 2, y + 16, 0xF02E2346);
		g.centeredText(font, n, cx, y + 4, WARN);
	}

	// ---------------------------------------------------------------- conversation

	private void drawConversation(GuiGraphicsExtractor g) {
		int top = y0 + HEADER + 6, bottom = y1 - PAD - INPUT - 8;
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
				out.add(userBubble(l.text().substring(2), crew ? who : null, width));
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
			if (crew) g.text(font, who, x, y, nameColor(who), false);
			int hy = y + head;
			int star = live ? ((ticks / 5) % 2 == 0 ? PUMPKIN : ACCENT_HI) : FAINT;
			g.text(font, "✻", x, hy + 1, star, false);
			long secs = Math.max(1, ((live ? System.currentTimeMillis() : end) - (start == 0 ? System.currentTimeMillis() : start)) / 1000);
			String label = live ? "Thinking… " + secs + "s" : "Thought for " + secs + "s" + (stepsF > 0 ? "  ·  " + stepsF + (stepsF == 1 ? " step" : " steps") : "") + (open ? "  ˅" : "  ›");
			int lw = font.width(label);
			boolean hot = !live && hover(x, hy, x + 12 + lw, hy + 11);
			g.text(font, label, x + 11, hy + 1, live ? DIM : hot ? TEXT : FAINT, false);
			if (!live) hits.add(new Hit(x, hy, x + 12 + lw, hy + 11, () -> {
				if (!expanded.remove(key)) expanded.add(key);
			}));
			if (body == 0) return;
			int ty = hy + 13;
			g.fill(x + 3, ty, x + 4, ty + body - 1, LINE);
			if (hiddenF > 0) {
				g.text(font, "… " + hiddenF + " earlier", x + 10, ty, FAINT, false);
				ty += 10;
			}
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 10, ty, DIM, false);
				ty += 10;
			}
		});
	}

	private String nameOf(CrewProtocol.Line l) {
		if (l.agent() != null) return l.agent();
		CrewProtocol.Session s = ClientConsole.sessions.get(l.session());
		return s != null ? s.label() : "Ghost";
	}

	private Block userBubble(String text, String to, int width) {
		int max = (int) (width * 0.72);
		List<FormattedCharSequence> rows = wrap(text, max - 16, 0xFFFFFFFF);
		int w = 16;
		for (FormattedCharSequence r : rows) w = Math.max(w, font.width(r) + 16);
		int label = to != null ? 11 : 0, fw = w, bh = rows.size() * 10 + 10;
		return new Block(bh + label, (g, left, y, right) -> {
			if (to != null) g.text(font, "you → " + to, right - font.width("you → " + to), y, FAINT, false);
			int by = y + label;
			round(g, right - fw, by, right, by + bh, USER_BUBBLE);
			int ty = by + 5;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, right - fw + 8, ty, 0xFFFFFFFF, false);
				ty += 10;
			}
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
				g.text(font, who, left + 24, y + 1, nameColor(who), false);
			}
			int by = y + label, bx = left + 24;
			round(g, bx, by, bx + fw, by + bh, AGENT_BUBBLE);
			int ty = by + 5;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, bx + 8, ty, TEXT, false);
				ty += 10;
			}
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
			if (crew) g.text(font, who, x, y, nameColor(who), false);
			int ty = y + head;
			g.fill(x, ty, x + 1, ty + extra + rows.size() * 10 - 1, LINE);
			if (hidden > 0) {
				g.text(font, "… " + hidden + " earlier steps", x + 7, ty, FAINT, false);
				ty += 10;
			}
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 7, ty, DIM, false);
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
			g.text(font, who, x, y + 2, FAINT, false);
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
			g.text(font, "⚠  Needs your approval", x + 8, y + 6, WARN, false);
			int ty = y + 18;
			for (FormattedCharSequence r : rows) {
				g.text(font, r, x + 8, ty, TEXT, false);
				ty += 10;
			}
			if (!ClientConsole.canCommand) {
				g.text(font, "Only the world owner or an operator can answer.", x + 8, ty + 6, DIM, false);
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
			g.text(font, m, mx + 8, my + 4, hot ? TEXT : DIM, false);
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
				g.text(font, "Kiro CLI isn't installed on the bridge PC", x, y + 8, WARN, false);
				g.text(font, trim("Install it from kiro.dev/downloads, or restart the launcher with --demo.", width - 20), x, y + 22, DIM, false);
				return;
			}
			if (!inProgress) {
				int textW = width - font.width("Sign in") - 40;
				g.text(font, trim("Sign in to Kiro so your ghosts can work", textW), x, y + 8, TEXT, false);
				g.text(font, trim("Opens Kiro's own sign-in. No passwords here.", textW), x, y + 22, DIM, false);
				if (ClientConsole.canCommand) button(g, right - font.width("Sign in") - 24, y + 13, "Sign in", ACCENT, () -> ClientConsole.send("kiro_login", null, null, null, null));
				return;
			}
			g.text(font, "Finish signing in to Kiro in your browser", x, y + 8, TEXT, false);
			if (ClientConsole.loginCode != null) {
				g.text(font, "Code:", x, y + 23, DIM, false);
				g.text(font, ClientConsole.loginCode, x + 34, y + 23, PUMPKIN, false);
			} else if (!ClientConsole.loginLines.isEmpty()) {
				g.text(font, trim(ClientConsole.loginLines.get(ClientConsole.loginLines.size() - 1), width - 20), x, y + 23, DIM, false);
			}
			int bx = x;
			if (ClientConsole.loginUrl != null) {
				URI uri = URI.create(ClientConsole.loginUrl);
				bx = button(g, bx, y + 40, "Open sign-in page", ACCENT, () -> ConfirmLinkScreen.confirmLinkNow(this, uri)) + 8;
			}
			g.text(font, "waiting" + ".".repeat(1 + (ticks / 10) % 3), bx, y + 44, FAINT, false);
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
			g.text(font, "npx haunted-crew", x + 24, sy + 15, PUMPKIN, false);
			g.text(font, trim("Same PC? That's it, this screen updates itself.", right - x - 20), x + 18, sy + 30, DIM, false);
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
		g.text(font, text, x + 18, y, TEXT, false);
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
		if (font.width(s) <= maxW) return s;
		while (s.length() > 1 && font.width(s + "…") > maxW) s = s.substring(0, s.length() - 1);
		return s + "…";
	}

	private static int nameColor(String name) {
		int[] palette = {0xFF9CC4FF, 0xFFFFC08A, 0xFFA6EBA0, 0xFFF0A8E8, 0xFF8AEBDF, 0xFFFFE38A, 0xFFCDB4FF};
		return palette[Math.floorMod(name.hashCode(), palette.length)];
	}
}
