package dev.hauntedcrew.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * Code review for ghost work: each workflow run that changed files waits here on its own git branch.
 * Read the diff, then Merge (the bridge builds the merge commit off-tree and fast-forwards your branch),
 * Reject (drops the branch) or Request changes (a ghost reworks it). Needs the bridge started with --worktrees.
 */
public class MergeScreen extends Screen {
	private static final int BG = 0xF0101010, PANEL = 0xFF2B2B2B, FACE = 0xFF4A4A4A, HOT = 0xFF7A7A7A, LINE = 0xFF000000;
	private static final int TEXT = 0xFFFFFFFF, DIM = 0xFFA0A0A0, GOLD = 0xFFFFAA00, GREEN = 0xFF55FF55, RED = 0xFFFF5555, AQUA = 0xFF55FFFF;

	private record Item(String runId, String name, String status, int files, int added, int removed, String note) {}
	private record Hit(int x0, int y0, int x1, int y1, Runnable action) {}

	private final Screen parent;
	private final List<Hit> hits = new ArrayList<>();
	private final List<Item> items = new ArrayList<>();
	private final List<String> diffLines = new ArrayList<>();
	private String selected, diffFor, notice = "";
	private boolean enabled = true, feedbackMode;
	private int seenVersion = -1, scroll, tick, mx, my;
	private EditBox feedback;

	public MergeScreen(Screen parent) {
		super(Component.literal("Merges"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		feedback = new EditBox(font, width / 2 - 150, height - 54, 300, 14, Component.literal("feedback"));
		feedback.setMaxLength(500);
		feedback.setVisible(false);
		addRenderableWidget(feedback);
		ClientConsole.send("merge_list", null, null, null, null);
	}

	@Override
	public void tick() {
		if (++tick % 60 == 0) ClientConsole.send("merge_list", null, null, null, null);
		if (seenVersion == ClientConsole.workflowVersion) return;
		seenVersion = ClientConsole.workflowVersion;
		if (ClientConsole.mergeAnswer != null) {
			JsonObject a = parse(ClientConsole.mergeAnswer);
			ClientConsole.mergeAnswer = null;
			notice = a != null && a.has("status") ? "Result: " + a.get("status").getAsString() + (a.has("sha") ? " " + a.get("sha").getAsString() : "") : "";
			ClientConsole.send("merge_list", null, null, null, null);
		}
		JsonObject list = parse(ClientConsole.merges);
		if (list != null) {
			enabled = !list.has("enabled") || list.get("enabled").getAsBoolean();
			items.clear();
			JsonArray arr = list.has("merges") ? list.getAsJsonArray("merges") : new JsonArray();
			for (JsonElement e : arr) {
				JsonObject o = e.getAsJsonObject();
				items.add(new Item(str(o, "runId"), str(o, "name"), str(o, "status"), num(o, "files"), num(o, "additions"), num(o, "deletions"), str(o, "note")));
			}
			if (selected != null && items.stream().noneMatch(i -> i.runId.equals(selected))) {
				selected = null;
				diffFor = null;
				diffLines.clear();
			}
			if (selected == null && !items.isEmpty()) select(items.get(0).runId);
		}
		JsonObject d = parse(ClientConsole.mergeDiff);
		if (d != null && d.has("diff") && selected != null && !selected.equals(diffFor)) {
			diffFor = selected;
			diffLines.clear();
			for (String line : d.get("diff").getAsString().split("\n", -1)) diffLines.add(line.replace("\t", "    "));
			scroll = 0;
		}
	}

	private void select(String runId) {
		selected = runId;
		diffLines.clear();
		diffFor = null;
		ClientConsole.mergeDiff = null;
		ClientConsole.send("merge_diff", runId, null, null, null);
	}

	private static JsonObject parse(String json) {
		try {
			return json == null ? null : JsonParser.parseString(json).getAsJsonObject();
		} catch (RuntimeException e) {
			return null;
		}
	}

	private static String str(JsonObject o, String k) {
		return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
	}

	private static int num(JsonObject o, String k) {
		return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsInt() : 0;
	}

	private Item current() {
		return items.stream().filter(i -> i.runId.equals(selected)).findFirst().orElse(null);
	}

	private void answer(String option, String text) {
		if (selected == null) return;
		JsonObject o = new JsonObject();
		o.addProperty("option", option);
		if (text != null) o.addProperty("text", text);
		ClientConsole.send("merge_answer", selected, o.toString(), null, null);
		notice = "Sent: " + option;
		feedbackMode = false;
		feedback.setVisible(false);
		feedback.setValue("");
	}

	// ---------------------------------------------------------------- input

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		for (int i = hits.size() - 1; i >= 0; i--) {
			Hit h = hits.get(i);
			if (e.x() >= h.x0 && e.x() < h.x1 && e.y() >= h.y0 && e.y() < h.y1) {
				h.action.run();
				return true;
			}
		}
		return super.mouseClicked(e, doubleClick);
	}

	@Override
	public boolean mouseScrolled(double x, double y, double dx, double dy) {
		scroll = Math.max(0, Math.min(Math.max(0, diffLines.size() - 5), scroll - (int) (dy * 3)));
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (feedbackMode && (event.key() == InputConstants.KEY_RETURN || event.key() == InputConstants.KEY_NUMPADENTER)) {
			if (!feedback.getValue().isBlank()) answer("Request changes", feedback.getValue().trim());
			return true;
		}
		if (event.key() == InputConstants.KEY_ESCAPE) {
			if (feedbackMode) {
				feedbackMode = false;
				feedback.setVisible(false);
			} else onClose();
			return true;
		}
		return super.keyPressed(event);
	}

	@Override
	public void onClose() {
		Minecraft.getInstance().gui.setScreen(parent);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	// ---------------------------------------------------------------- drawing

	private void box(GuiGraphicsExtractor g, int x0, int y0, int x1, int y1, int c) {
		g.fill(x0, y0, x1, y1, LINE);
		g.fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, c);
		g.fill(x0 + 1, y0 + 1, x1 - 1, y0 + 2, c + 0x00282828);
		g.fill(x0 + 1, y1 - 2, x1 - 1, y1 - 1, Math.max(c - 0x00282828, 0xFF000000));
	}

	private void button(GuiGraphicsExtractor g, int x, int y, int w, String label, int color, Runnable action) {
		boolean hot = mx >= x && mx < x + w && my >= y && my < y + 16;
		box(g, x, y, x + w, y + 16, hot ? HOT : FACE);
		g.centeredText(font, label, x + w / 2, y + 4, hot ? 0xFFFFFFFF : color);
		hits.add(new Hit(x, y, x + w, y + 16, action));
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int a, int b, float partial) {
		g.fill(0, 0, width, height, BG);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int rawX, int rawY, float partial) {
		mx = rawX;
		my = rawY;
		hits.clear();
		box(g, 6, 6, width - 6, height - 6, PANEL);
		g.text(font, "Merges", 16, 14, GOLD, true);
		g.text(font, "ghost work waiting for your OK", 16 + font.width("Merges") + 8, 14, DIM, true);
		button(g, width - 62, 11, 48, "Close", TEXT, this::onClose);

		int listW = Math.min(190, width / 3), top = 30, bottom = height - 64;
		box(g, 12, top, 12 + listW, bottom, 0xFF1E1E1E);
		if (!enabled) {
			g.text(font, "Worktrees are off.", 20, top + 8, RED, true);
			g.text(font, "Start the bridge with --worktrees", 20, top + 20, DIM, true);
		} else if (items.isEmpty()) {
			g.text(font, "Nothing to review.", 20, top + 8, DIM, true);
			g.text(font, "Finished runs show up here.", 20, top + 20, DIM, true);
		}
		int y = top + 6;
		for (Item it : items) {
			if (y + 30 > bottom) break;
			boolean sel = it.runId.equals(selected), hot = mx >= 14 && mx < 10 + listW && my >= y && my < y + 28;
			box(g, 14, y, 10 + listW, y + 28, sel ? HOT : hot ? 0xFF5A5A5A : FACE);
			g.text(font, font.plainSubstrByWidth(it.name, listW - 16), 20, y + 4, TEXT, true);
			String s = "+" + it.added + " -" + it.removed + "  " + it.files + (it.files == 1 ? " file" : " files") + ("pending".equals(it.status) ? "" : "  " + it.status);
			g.text(font, s, 20, y + 16, "pending".equals(it.status) ? GREEN : GOLD, true);
			String id = it.runId;
			hits.add(new Hit(14, y, 10 + listW, y + 28, () -> select(id)));
			y += 32;
		}

		int dx0 = 12 + listW + 6, dx1 = width - 12;
		box(g, dx0, top, dx1, bottom, 0xFF1E1E1E);
		Item cur = current();
		int lines = Math.max(1, (bottom - top - 8) / 10);
		if (cur != null && diffLines.isEmpty()) g.text(font, "Loading diff...", dx0 + 8, top + 8, DIM, true);
		for (int i = 0; i < lines && scroll + i < diffLines.size(); i++) {
			String l = diffLines.get(scroll + i);
			int c = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") ? GOLD : l.startsWith("+") ? GREEN : l.startsWith("-") ? RED : l.startsWith("@@") ? AQUA : 0xFFD0D0D0;
			g.text(font, font.plainSubstrByWidth(l, dx1 - dx0 - 12), dx0 + 6, top + 5 + i * 10, c, false);
		}
		if (diffLines.size() > lines) g.text(font, (scroll + 1) + "-" + Math.min(diffLines.size(), scroll + lines) + " / " + diffLines.size() + "  (scroll)", dx1 - 130, top - 9, DIM, false);

		boolean can = cur != null && ("pending".equals(cur.status) || "conflict".equals(cur.status));
		int by = height - 36;
		if (can) {
			button(g, 14, by, 70, "Merge", GREEN, () -> answer("Merge", null));
			button(g, 90, by, 70, "Reject", RED, () -> answer("Reject", null));
			button(g, 166, by, 110, "Request changes", GOLD, () -> {
				feedbackMode = true;
				feedback.setVisible(true);
				setFocused(feedback);
				feedback.setFocused(true);
			});
		} else if (cur != null) {
			g.text(font, "Working on it: " + cur.status + "...", 16, by + 4, GOLD, true);
		}
		String line = !notice.isEmpty() ? notice : cur != null && !cur.note.isEmpty() ? cur.note : "";
		if (!line.isEmpty()) g.text(font, font.plainSubstrByWidth(line, width - 300), 290, by + 4, DIM, true);
		if (feedbackMode) g.text(font, "What should change? Enter to send, Esc to cancel", width / 2 - 150, height - 66, DIM, true);
		super.extractRenderState(g, rawX, rawY, partial);
	}
}
