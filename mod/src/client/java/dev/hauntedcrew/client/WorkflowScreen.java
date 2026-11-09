package dev.hauntedcrew.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.MultiLineEditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

/**
 * The workflow builder as a normal Minecraft menu: boxes and arrows like n8n. Start holds the task,
 * every agent box becomes a ghost, End collects the results. Drag a box to move it, drag from its
 * right dot to another box to connect, drag empty space to pan. The bridge stores and runs the
 * workflows; this screen talks to it through the server (ClientConsole "wf_*" actions).
 */
public class WorkflowScreen extends Screen {
	private static int BG = 0xF00E0A16, PANEL = 0xFF140F1F, PANEL2 = 0xFF1D1530, LINE = 0xFF2E2444, GRID = 0xFF1B1529;
	private static int TEXT = 0xFFECE8F4, DIM = 0xFF9A90B4, FAINT = 0xFF6B6385, ACCENT = 0xFF8B5CF6, ACCENT_HI = 0xFFA078FF;
	private static int PUMPKIN = 0xFFFF9A3C, OK = 0xFF4ADE80, BAD = 0xFFFF6B6B, WARN = 0xFFFFC94D;
	private static boolean mc, shadow;

	/** Follows the console's look: Kiro purple, or vanilla Minecraft (bevelled grey boxes, chat colours, text shadows). */
	private static void applyStyle() {
		mc = ConsoleScreen.mc;
		shadow = mc;
		if (mc) {
			BG = 0xF0101010; PANEL = 0xFF2B2B2B; PANEL2 = 0xFF4A4A4A; LINE = 0xFF000000; GRID = 0xFF1E1E1E;
			TEXT = 0xFFFFFFFF; DIM = 0xFFA0A0A0; FAINT = 0xFF707070; ACCENT = 0xFF6D6D6D; ACCENT_HI = 0xFFD0D0D0;
			PUMPKIN = 0xFFFFAA00; OK = 0xFF55FF55; BAD = 0xFFFF5555; WARN = 0xFFFFFF55;
		} else {
			BG = 0xF00E0A16; PANEL = 0xFF140F1F; PANEL2 = 0xFF1D1530; LINE = 0xFF2E2444; GRID = 0xFF1B1529;
			TEXT = 0xFFECE8F4; DIM = 0xFF9A90B4; FAINT = 0xFF6B6385; ACCENT = 0xFF8B5CF6; ACCENT_HI = 0xFFA078FF;
			PUMPKIN = 0xFFFF9A3C; OK = 0xFF4ADE80; BAD = 0xFFFF6B6B; WARN = 0xFFFFC94D;
		}
	}

	private static int shade(int c, int d) {
		int r = Math.max(0, Math.min(255, ((c >> 16) & 255) + d)), gr = Math.max(0, Math.min(255, ((c >> 8) & 255) + d)), b = Math.max(0, Math.min(255, (c & 255) + d));
		return (c & 0xFF000000) | (r << 16) | (gr << 8) | b;
	}

	private static int mcColor(int c) {
		return switch (c) {
			case 0xFF2A2140 -> 0xFF7A7A7A; // hovered button
			case 0xFF241A3A -> 0xFF5A5A5A; // selected box
			case 0xFF0E0A16 -> 0xFF121212; // canvas
			default -> c;
		};
	}
	private static final int TOP = 24, LEFT = 128, RIGHT = 176, BW = 104, BH = 34;
	private static final double S = 0.55; // workflow units (shared with the web editor) -> screen px
	private static final String[] JOBS = {"Planner", "Coder", "Tester", "Reviewer", "Docs", "Researcher"};
	private static final int[] JOB_COLORS = {0xFFA6C8FF, 0xFF7DD3FC, 0xFF86EFAC, 0xFFF0ABFC, 0xFFFDE68A, 0xFFFDBA74};
	private static final String[][] MODELS = {{"", "Crew default"}, {"claude-haiku-5.5", "Haiku 5.5 · 0.06x"}, {"qwen3-coder-next", "Qwen3 Coder · 0.05x"},
		{"claude-sonnet-5.5", "Sonnet 5.5 · 1.3x"}, {"claude-opus-5.5", "Opus 5.5 · 2x"}, {"auto", "Auto · 1x"}};

	private static final class Node {
		String id, type, name = "", job = "Coder", model = "", agentId = "", instructions = "", task = "";
		double x, y;
	}

	private record Edge(String from, String to) {}

	private record Hit(int x0, int y0, int x1, int y1, Runnable action) {}

	private final Screen parent;
	private final List<Hit> hits = new ArrayList<>();
	private float k = 1f;
	private int vw, vh, mouseX, mouseY, ticks, seenVersion = -1;

	// The workflow being edited.
	private String wfId;
	private final List<Node> nodes = new ArrayList<>();
	private final List<Edge> edges = new ArrayList<>();
	private boolean dirty;
	private int nextId = 1;

	// Data from the bridge.
	private JsonObject data;
	private JsonObject run;
	private JsonArray skills = new JsonArray();
	private boolean canEdit;
	private String status = "loading…";
	private int statusColor = DIM;

	// Canvas interaction.
	private double panX = 20, panY = 40, zoom = 1; // canvas: screen = LEFT/TOP + pan + world * zoom
	private Node selected, dragNode, connectFrom;
	private boolean panning;
	private double grabDX, grabDY;

	// Widgets.
	private EditBox nameBox, ghostNameBox, agentNameBox;
	private MultiLineEditBox textBox, agentTextBox;
	private Node inspected;

	// Custom agent editor (modal).
	private JsonObject agentEdit; // null = closed
	private int agentJob, agentModel, skillPick = -1;
	private boolean agentSkill;

	public WorkflowScreen(Screen parent) {
		applyStyle();
		super(Component.literal("Workflows"));
		this.parent = parent;
	}

	// ---------------------------------------------------------------- setup

	@Override
	protected void init() {
		int guiScale = Minecraft.getInstance().getWindow().getGuiScale();
		int px = Math.max(2, Math.round(guiScale * 0.5f));
		k = Math.min(1f, (float) px / Math.max(1, guiScale));
		vw = Math.round(width / k);
		vh = Math.round(height / k);
		String name = nameBox == null ? "" : nameBox.getValue();
		nameBox = new EditBox(font, 92, 6, 150, 13, Component.literal("Workflow name"));
		nameBox.setMaxLength(60);
		nameBox.setValue(name);
		nameBox.setResponder(v -> dirty = true);
		addRenderableWidget(nameBox);
		inspected = null; // inspector widgets are rebuilt on the next frame
		ghostNameBox = null;
		textBox = null;
		if (agentEdit != null) openAgentEditor(agentEdit);
		if (data == null) {
			ClientConsole.send("wf_list", null, null, null, null);
			ClientConsole.send("wf_skills", null, null, null, null);
		}
	}

	@Override
	public void tick() {
		ticks++;
		if (seenVersion != ClientConsole.workflowVersion) {
			seenVersion = ClientConsole.workflowVersion;
			absorb();
		}
		// While a run is going, ask for its progress every second.
		if (run != null && "running".equals(str(run, "status")) && ticks % 20 == 0) ClientConsole.send("wf_run_get", str(run, "id"), null, null, null);
		if (ClientConsole.notice != null && System.currentTimeMillis() - ClientConsole.noticeAt < 300) setStatus(ClientConsole.notice, WARN);
	}

	/** Takes in whatever the bridge sent since last tick. */
	private void absorb() {
		if (ClientConsole.workflowSaved != null) {
			JsonObject saved = parse(ClientConsole.workflowSaved);
			ClientConsole.workflowSaved = null;
			if (saved != null) {
				wfId = str(saved, "id");
				dirty = false;
				setStatus("Saved “" + str(saved, "name") + "”", OK);
				if (pendingRunAfterSave) {
					pendingRunAfterSave = false;
					startRun();
				}
			}
			ClientConsole.send("wf_list", null, null, null, null);
		}
		if (ClientConsole.workflows != null) {
			JsonObject d = parse(ClientConsole.workflows);
			ClientConsole.workflows = null;
			if (d != null) {
				boolean first = data == null;
				data = d;
				canEdit = d.has("canEdit") && d.get("canEdit").getAsBoolean();
				if (first) {
					JsonArray wfs = arr(d, "workflows");
					if (!wfs.isEmpty()) load(wfs.get(0).getAsJsonObject(), false);
					else if (!arr(d, "templates").isEmpty()) load(arr(d, "templates").get(0).getAsJsonObject(), true);
					setStatus(canEdit ? "ready" : "view only: ask an operator to edit", canEdit ? DIM : WARN);
					for (JsonElement r : arr(d, "runs")) {
						JsonObject ro = r.getAsJsonObject();
						if ("running".equals(str(ro, "status")) && str(ro, "workflowId").equals(wfId)) run = ro;
					}
				}
			}
		}
		if (ClientConsole.workflowRun != null) {
			JsonObject r = parse(ClientConsole.workflowRun);
			ClientConsole.workflowRun = null;
			if (r != null) {
				boolean wasRunning = run != null && "running".equals(str(run, "status"));
				run = r;
				String st = str(r, "status");
				if ("running".equals(st)) setStatus("Running… watch the ghosts in the office", PUMPKIN);
				else if (wasRunning || !"running".equals(st)) setStatus("Run " + st, "done".equals(st) ? OK : BAD);
			}
		}
		if (ClientConsole.skills != null) {
			JsonObject sk = parse(ClientConsole.skills);
			ClientConsole.skills = null;
			if (sk != null) skills = arr(sk, "skills");
		}
	}

	private boolean pendingRunAfterSave;

	private void setStatus(String text, int color) {
		status = text;
		statusColor = color;
	}

	// ---------------------------------------------------------------- model <-> JSON

	private void load(JsonObject wf, boolean asCopy) {
		nodes.clear();
		edges.clear();
		for (JsonElement e : arr(wf, "nodes")) {
			JsonObject o = e.getAsJsonObject();
			Node n = new Node();
			n.id = str(o, "id");
			n.type = str(o, "type");
			n.x = o.has("x") ? o.get("x").getAsDouble() : 0;
			n.y = o.has("y") ? o.get("y").getAsDouble() : 0;
			JsonObject d = o.has("data") && o.get("data").isJsonObject() ? o.getAsJsonObject("data") : new JsonObject();
			n.name = str(d, "name");
			n.job = str(d, "job").isEmpty() ? "Coder" : str(d, "job");
			n.model = str(d, "model");
			n.agentId = str(d, "agentId");
			n.instructions = str(d, "instructions");
			n.task = str(d, "task");
			nodes.add(n);
		}
		for (JsonElement e : arr(wf, "edges")) edges.add(new Edge(str(e.getAsJsonObject(), "from"), str(e.getAsJsonObject(), "to")));
		wfId = asCopy ? null : str(wf, "id");
		nameBox.setValue(str(wf, "name"));
		nameBox.moveCursorToStart(false);
		dirty = false;
		selected = null;
		run = null;
		fit();
	}

	private JsonObject toJson() {
		JsonObject wf = new JsonObject();
		if (wfId != null) wf.addProperty("id", wfId);
		wf.addProperty("name", nameBox.getValue().isBlank() ? "Untitled workflow" : nameBox.getValue().trim());
		JsonArray ns = new JsonArray();
		for (Node n : nodes) {
			JsonObject o = new JsonObject();
			o.addProperty("id", n.id);
			o.addProperty("type", n.type);
			o.addProperty("x", (int) Math.round(n.x));
			o.addProperty("y", (int) Math.round(n.y));
			JsonObject d = new JsonObject();
			if (n.type.equals("agent")) {
				d.addProperty("name", n.name);
				d.addProperty("job", n.job);
				d.addProperty("model", n.model);
				d.addProperty("agentId", n.agentId);
				d.addProperty("instructions", n.instructions);
			} else if (n.type.equals("start")) {
				d.addProperty("task", n.task);
			}
			o.add("data", d);
			ns.add(o);
		}
		wf.add("nodes", ns);
		JsonArray es = new JsonArray();
		for (Edge e : edges) {
			JsonObject o = new JsonObject();
			o.addProperty("from", e.from);
			o.addProperty("to", e.to);
			es.add(o);
		}
		wf.add("edges", es);
		return wf;
	}

	private String newId() {
		String id;
		do id = "g" + nextId++; while (byId(id) != null);
		return id;
	}

	private Node byId(String id) {
		for (Node n : nodes) if (n.id.equals(id)) return n;
		return null;
	}

	/** Pan so the workflow sits in the middle of the canvas (or starts top-left if it is wider). */
	private void fit() {
		if (nodes.isEmpty()) return;
		double minX = Double.MAX_VALUE, minY = Double.MAX_VALUE, maxX = -Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
		for (Node n : nodes) {
			minX = Math.min(minX, n.x * S);
			minY = Math.min(minY, n.y * S);
			maxX = Math.max(maxX, n.x * S + BW);
			maxY = Math.max(maxY, n.y * S + BH);
		}
		int cw = canvasX1() - LEFT - 28, ch = vh - TOP - 40;
		zoom = Math.max(0.35, Math.min(1, Math.min(cw / (maxX - minX), ch / (maxY - minY))));
		panX = (canvasX1() - LEFT - (maxX - minX) * zoom) / 2 - minX * zoom;
		panY = (vh - TOP - (maxY - minY) * zoom) / 2 - minY * zoom;
	}

	private int canvasX1() {
		return vw - RIGHT;
	}

	// Box corners in canvas (world) space; the canvas is drawn scaled by `zoom`.
	private int bx(Node n) {
		return (int) Math.round(n.x * S);
	}

	private int by(Node n) {
		return (int) Math.round(n.y * S);
	}

	private double wx(double screenX) {
		return (screenX - LEFT - panX) / zoom;
	}

	private double wy(double screenY) {
		return (screenY - TOP - panY) / zoom;
	}

	private boolean wouldLoop(String from, String to) {
		// Adding from->to makes a loop if "from" is reachable from "to".
		List<String> stack = new ArrayList<>(List.of(to));
		java.util.Set<String> seen = new java.util.HashSet<>();
		while (!stack.isEmpty()) {
			String cur = stack.remove(stack.size() - 1);
			if (cur.equals(from)) return true;
			if (!seen.add(cur)) continue;
			for (Edge e : edges) if (e.from.equals(cur)) stack.add(e.to);
		}
		return false;
	}

	// ---------------------------------------------------------------- actions

	private void addBox(String type, String job, JsonObject custom) {
		Node n = new Node();
		n.id = newId();
		n.type = type;
		double maxX = -240;
		for (Node o : nodes) maxX = Math.max(maxX, o.x);
		n.x = maxX + 240;
		n.y = 160;
		if (type.equals("agent")) {
			n.job = custom != null ? str(custom, "job") : job;
			n.name = custom != null ? str(custom, "name") : job;
			n.model = custom != null ? str(custom, "model") : "";
			n.agentId = custom != null ? str(custom, "id") : "";
		}
		// Auto-connect from the selected box: building a chain is click, click, click.
		Node from = selected != null && !selected.type.equals("end") ? selected : null;
		nodes.add(n);
		if (from != null && !type.equals("start")) edges.add(new Edge(from.id, n.id));
		selected = n;
		dirty = true;
		fit();
	}

	private void deleteSelected() {
		if (selected == null) return;
		String id = selected.id;
		nodes.remove(selected);
		edges.removeIf(e -> e.from.equals(id) || e.to.equals(id));
		selected = null;
		dirty = true;
	}

	private void save(boolean thenRun) {
		if (!canEdit) return;
		String json = toJson().toString();
		if (json.length() > 60_000) {
			setStatus("Workflow too big to send: shorten some instructions", BAD);
			return;
		}
		pendingRunAfterSave = thenRun;
		ClientConsole.send("wf_save", null, json, null, null);
		setStatus("Saving…", DIM);
	}

	private void runWorkflow() {
		if (!canEdit) return;
		if (nodes.stream().noneMatch(n -> n.type.equals("agent"))) {
			setStatus("Add at least one agent box", WARN);
			return;
		}
		if (dirty || wfId == null) save(true);
		else startRun();
	}

	private void startRun() {
		String task = nodes.stream().filter(n -> n.type.equals("start")).map(n -> n.task).findFirst().orElse("");
		ClientConsole.send("wf_run", wfId, task, null, null);
		setStatus("Starting…", PUMPKIN);
	}

	private void cycleSaved(int dir) {
		if (data == null) return;
		JsonArray wfs = arr(data, "workflows");
		if (wfs.isEmpty()) return;
		int i = 0;
		for (int j = 0; j < wfs.size(); j++) if (str(wfs.get(j).getAsJsonObject(), "id").equals(wfId)) i = j + dir;
		load(wfs.get(Math.floorMod(i, wfs.size())).getAsJsonObject(), false);
	}

	// ---------------------------------------------------------------- custom agent editor

	private void openAgentEditor(JsonObject a) {
		agentEdit = a;
		agentJob = Math.max(0, java.util.Arrays.asList(JOBS).indexOf(str(a, "job")));
		agentModel = 0;
		for (int i = 0; i < MODELS.length; i++) if (MODELS[i][0].equals(str(a, "model"))) agentModel = i;
		agentSkill = "skill".equals(str(a, "source"));
		int[] r = modalRect();
		if (agentNameBox != null) removeWidget(agentNameBox);
		if (agentTextBox != null) removeWidget(agentTextBox);
		agentNameBox = new EditBox(font, r[0] + 12, r[1] + 34, 160, 13, Component.literal("Agent name"));
		agentNameBox.setMaxLength(40);
		agentNameBox.setValue(str(a, "name"));
		agentNameBox.setHint(Component.literal("Agent name"));
		addRenderableWidget(agentNameBox);
		agentTextBox = MultiLineEditBox.builder().setX(r[0] + 12).setY(r[1] + 100).setPlaceholder(Component.literal("What should this agent do, and how? Or paste a SKILL.md."))
			.setTextColor(TEXT).build(font, r[2] - r[0] - 24, r[3] - r[1] - 140, Component.literal("Instructions"));
		agentTextBox.setCharacterLimit(8000);
		agentTextBox.setValue(str(a, "instructions"));
		addRenderableWidget(agentTextBox);
		setFocused(agentNameBox);
	}

	private void closeAgentEditor() {
		agentEdit = null;
		if (agentNameBox != null) removeWidget(agentNameBox);
		if (agentTextBox != null) removeWidget(agentTextBox);
		agentNameBox = null;
		agentTextBox = null;
		skillPick = -1;
	}

	private void saveAgent() {
		JsonObject a = new JsonObject();
		if (!str(agentEdit, "id").isEmpty()) a.addProperty("id", str(agentEdit, "id"));
		a.addProperty("name", agentNameBox.getValue());
		a.addProperty("job", JOBS[agentJob]);
		a.addProperty("model", MODELS[agentModel][0]);
		a.addProperty("source", agentSkill ? "skill" : "prompt");
		a.addProperty("instructions", agentTextBox.getValue());
		ClientConsole.send("agent_save", null, a.toString(), null, null);
		closeAgentEditor();
		setStatus("Agent saved", OK);
	}

	private int[] modalRect() {
		int w = Math.min(420, vw - 40), h = Math.min(300, vh - 40);
		int x = (vw - w) / 2, y = (vh - h) / 2;
		return new int[] {x, y, x + w, y + h};
	}

	// ---------------------------------------------------------------- inspector widgets

	/** (Re)creates the text fields for the selected box when the selection changes. */
	private void syncInspector() {
		if (inspected == selected && (selected == null || ghostNameBox != null || textBox != null)) return;
		if (ghostNameBox != null) removeWidget(ghostNameBox);
		if (textBox != null) removeWidget(textBox);
		ghostNameBox = null;
		textBox = null;
		inspected = selected;
		if (selected == null || selected.type.equals("end")) return;
		int x = canvasX1() + 10, w = RIGHT - 20;
		Node n = selected;
		int ty;
		if (n.type.equals("agent")) {
			ghostNameBox = new EditBox(font, x, TOP + 30, w, 13, Component.literal("Ghost name"));
			ghostNameBox.setMaxLength(40);
			ghostNameBox.setValue(n.name);
			ghostNameBox.setResponder(v -> {
				n.name = v.replaceAll("[^\\w .-]", "");
				dirty = true;
			});
			ghostNameBox.setEditable(canEdit);
			addRenderableWidget(ghostNameBox);
			ty = TOP + 116;
		} else {
			ty = TOP + 30;
		}
		boolean start = n.type.equals("start");
		textBox = MultiLineEditBox.builder().setX(x).setY(ty).setTextColor(TEXT)
			.setPlaceholder(Component.literal(start ? "What should the crew do?" : "Extra instructions for this step (optional)"))
			.build(font, w, start ? 90 : 70, Component.literal(start ? "Task" : "Instructions"));
		textBox.setCharacterLimit(start ? 4000 : 6000);
		textBox.setValue(start ? n.task : n.instructions);
		textBox.setValueListener(v -> {
			if (start) n.task = v;
			else n.instructions = v;
			dirty = true;
		});
		addRenderableWidget(textBox);
	}

	// ---------------------------------------------------------------- input

	private MouseButtonEvent zoomed(MouseButtonEvent e) {
		return new MouseButtonEvent(e.x() / k, e.y() / k, e.buttonInfo());
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent raw, boolean doubleClick) {
		MouseButtonEvent e = zoomed(raw);
		double mx = e.x(), my = e.y();
		for (int i = hits.size() - 1; i >= 0; i--) {
			Hit h = hits.get(i);
			if (mx >= h.x0 && mx < h.x1 && my >= h.y0 && my < h.y1) {
				h.action.run();
				return true;
			}
		}
		if (super.mouseClicked(e, doubleClick)) return true;
		if (agentEdit != null) return true;
		if (mx < LEFT || mx >= canvasX1() || my < TOP) return false;
		setFocused(null);
		mx = wx(mx);
		my = wy(my);
		// Output dot: start an arrow.
		for (int i = nodes.size() - 1; i >= 0; i--) {
			Node n = nodes.get(i);
			if (!n.type.equals("end") && Math.abs(mx - (bx(n) + BW)) <= 5 && Math.abs(my - (by(n) + BH / 2.0)) <= 5) {
				if (canEdit) connectFrom = n;
				return true;
			}
		}
		for (int i = nodes.size() - 1; i >= 0; i--) {
			Node n = nodes.get(i);
			if (mx >= bx(n) && mx < bx(n) + BW && my >= by(n) && my < by(n) + BH) {
				selected = n;
				if (canEdit) {
					dragNode = n;
					grabDX = mx - bx(n);
					grabDY = my - by(n);
				}
				return true;
			}
		}
		selected = null;
		panning = true;
		return true;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent raw, double dx, double dy) {
		MouseButtonEvent e = zoomed(raw);
		if (dragNode != null) {
			dragNode.x = (wx(e.x()) - grabDX) / S;
			dragNode.y = (wy(e.y()) - grabDY) / S;
			dirty = true;
			return true;
		}
		if (panning) {
			panX += dx / k;
			panY += dy / k;
			return true;
		}
		if (connectFrom != null) return true;
		return super.mouseDragged(e, dx / k, dy / k);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent raw) {
		MouseButtonEvent e = zoomed(raw);
		if (connectFrom != null) {
			for (Node n : nodes) {
				if (n == connectFrom || n.type.equals("start")) continue;
				double ex = wx(e.x()), ey = wy(e.y());
				if (ex >= bx(n) - 6 && ex < bx(n) + BW && ey >= by(n) && ey < by(n) + BH) {
					Edge edge = new Edge(connectFrom.id, n.id);
					if (edges.contains(edge)) break;
					if (wouldLoop(connectFrom.id, n.id)) setStatus("That arrow would make a loop", WARN);
					else {
						edges.add(edge);
						dirty = true;
					}
					break;
				}
			}
		}
		connectFrom = null;
		dragNode = null;
		panning = false;
		return super.mouseReleased(e);
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double dx, double dy) {
		if (agentEdit != null || mx / k > canvasX1()) return super.mouseScrolled(mx / k, my / k, dx, dy);
		// Wheel zooms around the mouse.
		double before = zoom, sx = mx / k, sy = my / k;
		zoom = Math.max(0.3, Math.min(1.6, zoom * (dy > 0 ? 1.1 : 1 / 1.1)));
		panX = sx - LEFT - (sx - LEFT - panX) * zoom / before;
		panY = sy - TOP - (sy - TOP - panY) * zoom / before;
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_ESCAPE) {
			if (agentEdit != null) closeAgentEditor();
			else onClose();
			return true;
		}
		boolean typing = getFocused() instanceof EditBox || getFocused() instanceof MultiLineEditBox;
		if (!typing && canEdit && (key == InputConstants.KEY_DELETE || key == InputConstants.KEY_BACKSPACE)) {
			deleteSelected();
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

	@Override
	public void extractBackground(GuiGraphicsExtractor g, int mx, int my, float partial) {
		g.fill(0, 0, width, height, BG);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int rawX, int rawY, float partial) {
		mouseX = (int) (rawX / k);
		mouseY = (int) (rawY / k);
		hits.clear();
		syncInspector();
		g.pose().pushMatrix();
		g.pose().scale(k, k);
		drawCanvas(g);
		drawLeft(g);
		drawRight(g);
		drawTop(g);
		if (agentEdit != null) drawAgentEditor(g);
		super.extractRenderState(g, mouseX, mouseY, partial);
		if (agentEdit != null && agentTextBox != null && agentTextBox.getValue().isEmpty()) { /* placeholder drawn by the widget */ }
		g.pose().popMatrix();
	}

	private void drawTop(GuiGraphicsExtractor g) {
		g.fill(0, 0, vw, TOP, PANEL);
		g.fill(0, TOP - 1, vw, TOP, LINE);
		g.text(font, "Workflows", 8, 8, PUMPKIN, shadow);
		int x = 70;
		x = button(g, x, 5, "◀", true, () -> cycleSaved(-1)) + 2;
		nameBox.setX(x + 2);
		x += 156;
		x = button(g, x, 5, "▶", true, () -> cycleSaved(1)) + 8;
		x = button(g, x, 5, "New", canEdit, () -> {
			nodes.clear();
			edges.clear();
			Node s = new Node();
			s.id = newId();
			s.type = "start";
			s.x = 60;
			s.y = 160;
			nodes.add(s);
			wfId = null;
			nameBox.setValue("New workflow");
			selected = s;
			run = null;
			dirty = true;
			fit();
		}) + 4;
		x = button(g, x, 5, dirty ? "Save*" : "Save", canEdit, () -> save(false)) + 4;
		x = button(g, x, 5, "Delete", canEdit && wfId != null, () -> {
			ClientConsole.send("wf_delete", wfId, null, null, null);
			wfId = null;
			setStatus("Deleted", DIM);
		}) + 10;
		boolean running = run != null && "running".equals(str(run, "status"));
		int rw = font.width(running ? "■ Stop" : "▶ Run") + 14, rx = vw - rw - 8;
		boolean hot = hover(rx, 5, rx + rw, 19);
		fillRound(g, rx, 5, rx + rw, 19, !canEdit ? PANEL2 : running ? (hot ? 0xFFB34747 : 0xFF8F3838) : (hot ? ACCENT_HI : ACCENT));
		g.text(font, running ? "■ Stop" : "▶ Run", rx + 7, 8, canEdit ? 0xFFFFFFFF : FAINT, shadow);
		if (canEdit) hits.add(new Hit(rx, 5, rx + rw, 19, running ? () -> ClientConsole.send("wf_stop", str(run, "id"), null, null, null) : this::runWorkflow));
		g.text(font, trim(status, rx - x - 10), x, 8, statusColor, shadow);
	}

	private void drawLeft(GuiGraphicsExtractor g) {
		g.fill(0, TOP, LEFT, vh, PANEL);
		g.fill(LEFT - 1, TOP, LEFT, vh, LINE);
		int x = 8, y = TOP + 8, w = LEFT - 16;
		g.text(font, "ADD A BOX", x, y, FAINT, shadow);
		y += 12;
		y = palette(g, x, y, w, "Start (the task)", OK, () -> addBox("start", null, null));
		for (int i = 0; i < JOBS.length; i++) {
			String job = JOBS[i];
			y = palette(g, x, y, w, job, JOB_COLORS[i], () -> addBox("agent", job, null));
		}
		y = palette(g, x, y, w, "End (results)", BAD, () -> addBox("end", null, null));
		y += 6;
		g.text(font, "MY AGENTS", x, y, FAINT, shadow);
		if (canEdit) {
			int nx = x + w - font.width("+ New");
			g.text(font, "+ New", nx, y, hover(nx, y - 2, x + w, y + 9) ? ACCENT_HI : ACCENT, shadow);
			hits.add(new Hit(nx, y - 2, x + w, y + 9, () -> {
				JsonObject a = new JsonObject();
				a.addProperty("job", "Coder");
				openAgentEditor(a);
			}));
		}
		y += 12;
		JsonArray agents = data == null ? new JsonArray() : arr(data, "agents");
		if (agents.isEmpty()) {
			g.text(font, "none yet", x, y, FAINT, shadow);
			y += 12;
		}
		for (JsonElement el : agents) {
			if (y > vh - 80) break;
			JsonObject a = el.getAsJsonObject();
			int jc = JOB_COLORS[Math.max(0, java.util.Arrays.asList(JOBS).indexOf(str(a, "job")))];
			y = palette(g, x, y, w - 22, "★ " + str(a, "name"), jc, () -> addBox("agent", null, a));
			int ex = x + w - 18;
			g.text(font, "edit", ex, y - 14, hover(ex, y - 16, x + w, y - 4) ? TEXT : FAINT, shadow);
			if (canEdit) hits.add(new Hit(ex, y - 16, x + w, y - 4, () -> openAgentEditor(a)));
		}
		y += 6;
		g.text(font, "TEMPLATES", x, y, FAINT, shadow);
		y += 12;
		JsonArray templates = data == null ? new JsonArray() : arr(data, "templates");
		for (JsonElement el : templates) {
			if (y > vh - 16) break;
			JsonObject t = el.getAsJsonObject();
			String name = str(t, "name");
			boolean hot = hover(x, y, x + w, y + 22);
			fillRound(g, x, y, x + w, y + 22, hot ? 0xFF2A2140 : PANEL2);
			List<FormattedCharSequence> rows = font.split(Component.literal(name), w - 8);
			for (int i = 0; i < Math.min(2, rows.size()); i++) g.text(font, rows.get(i), x + 4, y + 2 + i * 9, hot ? PUMPKIN : TEXT, shadow);
			hits.add(new Hit(x, y, x + w, y + 22, () -> load(t, true)));
			y += 25;
		}
	}

	private int palette(GuiGraphicsExtractor g, int x, int y, int w, String label, int color, Runnable action) {
		boolean on = canEdit;
		boolean hot = on && hover(x, y, x + w, y + 14);
		fillRound(g, x, y, x + w, y + 14, hot ? 0xFF2A2140 : PANEL2);
		g.fill(x + 5, y + 5, x + 9, y + 9, color);
		g.text(font, trim(label, w - 16), x + 13, y + 3, on ? TEXT : FAINT, shadow);
		if (on) hits.add(new Hit(x, y, x + w, y + 14, action));
		return y + 16;
	}

	private void drawCanvas(GuiGraphicsExtractor g) {
		int x1 = canvasX1();
		g.enableScissor(LEFT, TOP, x1, vh);
		g.fill(LEFT, TOP, x1, vh, mc ? mcColor(0xFF0E0A16) : 0xFF0E0A16);
		// Dot grid that moves with the pan and zoom.
		int step = Math.max(6, (int) Math.round(16 * zoom));
		int ox = (int) Math.floorMod((long) panX, (long) step), oy = (int) Math.floorMod((long) panY, (long) step);
		for (int gx = LEFT + ox; gx < x1; gx += step) for (int gy = TOP + oy; gy < vh; gy += step) g.fill(gx, gy, gx + 1, gy + 1, GRID);
		if (nodes.isEmpty()) g.centeredText(font, "Pick a template on the left, or add boxes.", (LEFT + x1) / 2, vh / 2, FAINT);
		int smx = mouseX, smy = mouseY;
		g.pose().pushMatrix();
		g.pose().translate((float) (LEFT + panX), (float) (TOP + panY));
		g.pose().scale((float) zoom, (float) zoom);
		mouseX = (int) Math.floor(wx(smx));
		mouseY = (int) Math.floor(wy(smy));

		Map<String, String> stepStatus = new HashMap<>();
		if (run != null && str(run, "workflowId").equals(wfId) && run.has("steps")) {
			for (Map.Entry<String, JsonElement> s : run.getAsJsonObject("steps").entrySet()) stepStatus.put(s.getKey(), str(s.getValue().getAsJsonObject(), "status"));
		}
		// Arrows first, under the boxes.
		for (Edge e : new ArrayList<>(edges)) {
			Node a = byId(e.from), b = byId(e.to);
			if (a == null || b == null) continue;
			int ax = bx(a) + BW, ay = by(a) + BH / 2, cx = bx(b), cy = by(b) + BH / 2;
			boolean flowing = "running".equals(stepStatus.get(b.id)) || ("done".equals(stepStatus.get(a.id)) && "running".equals(stepStatus.get(b.id)));
			int[] mid = curve(g, ax, ay, cx, cy, flowing ? PUMPKIN : ACCENT, flowing);
			if (canEdit && Math.abs(mouseX - mid[0]) < 6 && Math.abs(mouseY - mid[1]) < 6) {
				fillRound(g, mid[0] - 5, mid[1] - 5, mid[0] + 6, mid[1] + 6, BAD);
				g.text(font, "×", mid[0] - 2, mid[1] - 4, 0xFFFFFFFF, shadow);
				int hx = (int) (LEFT + panX + mid[0] * zoom), hy = (int) (TOP + panY + mid[1] * zoom), hr = (int) Math.ceil(7 * zoom);
				hits.add(new Hit(hx - hr, hy - hr, hx + hr, hy + hr, () -> {
					edges.remove(e);
					dirty = true;
				}));
			}
		}
		if (connectFrom != null) curve(g, bx(connectFrom) + BW, by(connectFrom) + BH / 2, mouseX, mouseY, PUMPKIN, false);

		for (Node n : nodes) {
			int x = bx(n), y = by(n);
			String st = stepStatus.get(n.id);
			int border = n == selected ? ACCENT_HI : "running".equals(st) ? PUMPKIN : "done".equals(st) ? OK : "failed".equals(st) ? BAD : LINE;
			if ("running".equals(st) && (ticks / 6) % 2 == 0) fillRound(g, x - 3, y - 3, x + BW + 3, y + BH + 3, 0x44FF9A3C);
			fillRound(g, x - 1, y - 1, x + BW + 1, y + BH + 1, border);
			fillRound(g, x, y, x + BW, y + BH, n == selected ? 0xFF241A3A : PANEL2);
			int dot = n.type.equals("start") ? OK : n.type.equals("end") ? BAD : JOB_COLORS[Math.max(0, java.util.Arrays.asList(JOBS).indexOf(n.job))];
			g.fill(x + 6, y + 7, x + 10, y + 11, dot);
			String title = n.type.equals("start") ? "Start" : n.type.equals("end") ? "End" : n.name;
			g.text(font, trim(title, BW - 18), x + 14, y + 5, TEXT, shadow);
			String sub = n.type.equals("start") ? (n.task.isBlank() ? "the task" : n.task.replace('\n', ' '))
				: n.type.equals("end") ? "collects the results"
				: (n.agentId.isEmpty() ? n.job : "★ custom") + (n.model.isEmpty() ? "" : " · " + n.model);
			g.text(font, trim(sub, BW - 12), x + 6, y + 15, DIM, shadow);
			if (st != null && !"waiting".equals(st)) {
				String label = "running".equals(st) ? "working…" : "done".equals(st) ? "✔ done" : "failed".equals(st) ? "✖ failed" : st;
				g.text(font, label, x + 6, y + 24, border, shadow);
			}
			// Ports.
			if (!n.type.equals("start")) fillRound(g, x - 4, y + BH / 2 - 4, x + 4, y + BH / 2 + 4, ACCENT);
			if (!n.type.equals("end")) {
				boolean hot = Math.abs(mouseX - (x + BW)) <= 5 && Math.abs(mouseY - (y + BH / 2)) <= 5;
				fillRound(g, x + BW - 4, y + BH / 2 - 4, x + BW + 4, y + BH / 2 + 4, hot ? PUMPKIN : ACCENT);
			}
		}
		g.pose().popMatrix();
		mouseX = smx;
		mouseY = smy;
		g.disableScissor();
		if (!nodes.isEmpty()) g.text(font, "drag boxes · drag a right dot to a box · wheel zooms · Delete removes", LEFT + 6, vh - 11, FAINT, shadow);
	}

	/** Cubic curve from an output dot to an input dot; returns its middle point. */
	private int[] curve(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int color, boolean animate) {
		double c = Math.max(30, Math.abs(bx - ax) / 2.0);
		int steps = (int) Math.max(12, Math.hypot(bx - ax, by - ay) / 2);
		int[] mid = {ax, ay};
		for (int i = 0; i <= steps; i++) {
			double t = (double) i / steps, u = 1 - t;
			double x = u * u * u * ax + 3 * u * u * t * (ax + c) + 3 * u * t * t * (bx - c) + t * t * t * bx;
			double y = u * u * u * ay + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * by;
			int col = animate && ((i + ticks / 2) % 8) < 3 ? 0xFFFFE0B0 : color;
			g.fill((int) x, (int) y, (int) x + 2, (int) y + 2, col);
			if (i == steps / 2) mid = new int[] {(int) x, (int) y};
		}
		return mid;
	}

	private void drawRight(GuiGraphicsExtractor g) {
		int x0 = canvasX1();
		g.fill(x0, TOP, vw, vh, PANEL);
		g.fill(x0, TOP, x0 + 1, vh, LINE);
		int x = x0 + 10, w = RIGHT - 20, y = TOP + 8;
		Node n = selected;
		if (n == null) {
			g.text(font, "WORKFLOW", x, y, FAINT, shadow);
			y += 12;
			for (FormattedCharSequence row : font.split(Component.literal("Click a box to edit it. Each agent box becomes a ghost in the office; boxes run as soon as every arrow into them is done. Put the task in the Start box, then press Run."), w)) {
				g.text(font, row, x, y, DIM, shadow);
				y += 10;
			}
			y += 6;
		} else if (n.type.equals("end")) {
			g.text(font, "END BOX", x, y, FAINT, shadow);
			g.text(font, "Collects every result.", x, y + 14, DIM, shadow);
			y += 30;
		} else if (n.type.equals("start")) {
			g.text(font, "START BOX · TASK", x, y, FAINT, shadow);
			y = TOP + 126;
		} else {
			g.text(font, "AGENT BOX", x, y, FAINT, shadow);
			g.text(font, "Ghost name", x, TOP + 21, DIM, shadow);
			int cy = TOP + 48;
			cy = cycle(g, x, cy, w, "Job", n.job, () -> {
				n.job = JOBS[(java.util.Arrays.asList(JOBS).indexOf(n.job) + 1) % JOBS.length];
				dirty = true;
			});
			String modelLabel = MODELS[0][1];
			for (String[] m : MODELS) if (m[0].equals(n.model)) modelLabel = m[1];
			cy = cycle(g, x, cy, w, "Model", modelLabel, () -> {
				int i = 0;
				for (int j = 0; j < MODELS.length; j++) if (MODELS[j][0].equals(n.model)) i = j;
				n.model = MODELS[(i + 1) % MODELS.length][0];
				dirty = true;
			});
			JsonArray agents = data == null ? new JsonArray() : arr(data, "agents");
			String agentLabel = "none";
			int ai = -1;
			for (int j = 0; j < agents.size(); j++) if (str(agents.get(j).getAsJsonObject(), "id").equals(n.agentId)) {
				ai = j;
				agentLabel = "★ " + str(agents.get(j).getAsJsonObject(), "name");
			}
			final int cur = ai;
			cycle(g, x, cy, w, "Custom", agentLabel, () -> {
				int next = cur + 1;
				if (next >= agents.size()) n.agentId = "";
				else {
					JsonObject a = agents.get(next).getAsJsonObject();
					n.agentId = str(a, "id");
					n.name = str(a, "name");
					n.job = str(a, "job");
					if (!str(a, "model").isEmpty()) n.model = str(a, "model");
					inspected = null; // refresh the name field
				}
				dirty = true;
			});
			g.text(font, "Instructions", x, TOP + 106, DIM, shadow);
			y = TOP + 192;
		}
		if (n != null && canEdit) {
			y = button(g, x, y, "Delete box", true, this::deleteSelected) > 0 ? y + 20 : y;
		}
		drawRun(g, x, y + 4, w);
	}

	private void drawRun(GuiGraphicsExtractor g, int x, int y, int w) {
		g.fill(x, y, x + w, y + 1, LINE);
		y += 6;
		g.text(font, "RUN", x, y, FAINT, shadow);
		if (run == null || !str(run, "workflowId").equals(wfId)) {
			g.text(font, "No run yet. Press ▶ Run.", x, y + 12, FAINT, shadow);
			return;
		}
		String st = str(run, "status");
		g.text(font, st, x + w - font.width(st), y, "done".equals(st) ? OK : "running".equals(st) ? PUMPKIN : BAD, shadow);
		y += 13;
		JsonObject steps = run.has("steps") ? run.getAsJsonObject("steps") : new JsonObject();
		String detail = null;
		for (Node n : nodes) {
			if (n.type.equals("start") || !steps.has(n.id)) continue;
			JsonObject s = steps.getAsJsonObject(n.id);
			String ss = str(s, "status");
			long secs = s.has("startedAt") ? ((s.has("endedAt") ? s.get("endedAt").getAsLong() : System.currentTimeMillis()) - s.get("startedAt").getAsLong()) / 1000 : -1;
			int color = "done".equals(ss) ? OK : "running".equals(ss) ? PUMPKIN : "failed".equals(ss) ? BAD : FAINT;
			String name = n.type.equals("end") ? "Result" : n.name;
			g.text(font, trim(name, w - 50), x, y, TEXT, shadow);
			String right = ss + (secs >= 0 ? " " + secs + "s" : "");
			g.text(font, right, x + w - font.width(right), y, color, shadow);
			y += 11;
			if (n == selected || (selected == null && n.type.equals("end"))) detail = !str(s, "error").isEmpty() ? str(s, "error") : str(s, "output");
		}
		if (detail != null && !detail.isBlank()) {
			y += 4;
			List<FormattedCharSequence> rows = new ArrayList<>();
			for (String line : detail.split("\n")) {
				if (line.isBlank()) continue;
				rows.addAll(font.split(Component.literal(line.replace("**", "").replace("`", "")), w));
			}
			int max = Math.max(1, (vh - y - 8) / 9);
			for (FormattedCharSequence r : rows.subList(0, Math.min(rows.size(), max))) {
				g.text(font, r, x, y, DIM, shadow);
				y += 9;
			}
		}
	}

	private int cycle(GuiGraphicsExtractor g, int x, int y, int w, String label, String value, Runnable action) {
		g.text(font, label, x, y + 3, DIM, shadow);
		int bx = x + 40;
		boolean hot = canEdit && hover(bx, y, x + w, y + 14);
		fillRound(g, bx, y, x + w, y + 14, hot ? 0xFF2A2140 : PANEL2);
		g.text(font, trim(value, x + w - bx - 16), bx + 5, y + 3, TEXT, shadow);
		g.text(font, "⟳", x + w - 10, y + 3, hot ? PUMPKIN : FAINT, shadow);
		if (canEdit) hits.add(new Hit(bx, y, x + w, y + 14, action));
		return y + 18;
	}

	private void drawAgentEditor(GuiGraphicsExtractor g) {
		g.fill(0, 0, vw, vh, 0xB0000000);
		int[] r = modalRect();
		fillRound(g, r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1, LINE);
		fillRound(g, r[0], r[1], r[2], r[3], PANEL);
		int x = r[0] + 12, y = r[1] + 10, w = r[2] - r[0] - 24;
		g.text(font, "Custom agent", x, y, PUMPKIN, shadow);
		g.text(font, "Its instructions are given to the ghost before every task.", x, y + 11, DIM, shadow);
		int cx = x + 172;
		cycle(g, cx, r[1] + 32, r[2] - 12 - cx, "Job", JOBS[agentJob], () -> agentJob = (agentJob + 1) % JOBS.length);
		cycle(g, x, r[1] + 52, 200, "Model", MODELS[agentModel][1], () -> agentModel = (agentModel + 1) % MODELS.length);
		// Source toggle.
		int ty = r[1] + 74;
		int half = 70;
		fillRound(g, x, ty, x + half, ty + 14, !agentSkill ? ACCENT : PANEL2);
		g.centeredText(font, "Plain prompt", x + half / 2, ty + 3, TEXT);
		hits.add(new Hit(x, ty, x + half, ty + 14, () -> agentSkill = false));
		fillRound(g, x + half + 2, ty, x + 2 * half + 2, ty + 14, agentSkill ? ACCENT : PANEL2);
		g.centeredText(font, "SKILL.md", x + half + 2 + half / 2, ty + 3, TEXT);
		hits.add(new Hit(x + half + 2, ty, x + 2 * half + 2, ty + 14, () -> agentSkill = true));
		// Load a SKILL.md from the project.
		int lx = x + 2 * half + 10;
		String load = skills.isEmpty() ? "no SKILL.md in project" : skillPick < 0 ? "Load SKILL.md from project ⟳" : "★ " + str(skills.get(skillPick).getAsJsonObject(), "name") + "  ⟳";
		boolean hot = !skills.isEmpty() && hover(lx, ty, x + w, ty + 14);
		fillRound(g, lx, ty, x + w, ty + 14, hot ? 0xFF2A2140 : PANEL2);
		g.text(font, trim(load, x + w - lx - 8), lx + 5, ty + 3, skills.isEmpty() ? FAINT : TEXT, shadow);
		if (!skills.isEmpty()) hits.add(new Hit(lx, ty, x + w, ty + 14, () -> {
			skillPick = (skillPick + 1) % skills.size();
			JsonObject s = skills.get(skillPick).getAsJsonObject();
			agentTextBox.setValue(str(s, "text"));
			agentSkill = true;
			if (agentNameBox.getValue().isBlank()) agentNameBox.setValue(str(s, "name").replaceAll("[^\\w .-]", ""));
		}));
		// Buttons.
		int byy = r[3] - 28;
		int bx = r[2] - 12;
		int sw = font.width("Save agent") + 16;
		fillRound(g, bx - sw, byy, bx, byy + 16, hover(bx - sw, byy, bx, byy + 16) ? ACCENT_HI : ACCENT);
		g.text(font, "Save agent", bx - sw + 8, byy + 4, 0xFFFFFFFF, shadow);
		hits.add(new Hit(bx - sw, byy, bx, byy + 16, this::saveAgent));
		bx -= sw + 6;
		bx = bx - (font.width("Cancel") + 14);
		button(g, bx, byy + 1, "Cancel", true, this::closeAgentEditor);
		if (!str(agentEdit, "id").isEmpty()) button(g, x, byy + 1, "Delete", true, () -> {
			ClientConsole.send("agent_delete", str(agentEdit, "id"), null, null, null);
			closeAgentEditor();
		});
	}

	// ---------------------------------------------------------------- primitives

	private int button(GuiGraphicsExtractor g, int x, int y, String label, boolean enabled, Runnable action) {
		int w = font.width(label) + 12;
		boolean hot = enabled && hover(x, y, x + w, y + 14);
		fillRound(g, x, y, x + w, y + 14, hot ? 0xFF2A2140 : PANEL2);
		g.text(font, label, x + 6, y + 3, enabled ? (hot ? TEXT : DIM) : FAINT, shadow);
		if (enabled) hits.add(new Hit(x, y, x + w, y + 14, action));
		return x + w;
	}

	private static void fillRound(GuiGraphicsExtractor g, int ax, int ay, int bx, int by, int color) {
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
		g.fill(ax + 1, ay, bx - 1, by, color);
		g.fill(ax, ay + 1, bx, by - 1, color);
	}

	private boolean hover(int ax, int ay, int bx, int by) {
		return mouseX >= ax && mouseX < bx && mouseY >= ay && mouseY < by;
	}

	private String trim(String s, int maxW) {
		if (s == null) return "";
		if (font.width(s) <= maxW) return s;
		while (s.length() > 1 && font.width(s + "…") > maxW) s = s.substring(0, s.length() - 1);
		return s + "…";
	}

	private static JsonObject parse(String json) {
		try {
			JsonElement e = JsonParser.parseString(json);
			return e.isJsonObject() ? e.getAsJsonObject() : null;
		} catch (RuntimeException ex) {
			return null;
		}
	}

	private static String str(JsonObject o, String key) {
		if (o == null || !o.has(key) || !o.get(key).isJsonPrimitive()) return "";
		return o.get(key).getAsString();
	}

	private static JsonArray arr(JsonObject o, String key) {
		return o != null && o.has(key) && o.get(key).isJsonArray() ? o.getAsJsonArray(key) : new JsonArray();
	}
}
