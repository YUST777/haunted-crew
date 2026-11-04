package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;

/**
 * Ghost Rush: a maze-chase mini game where the roles are flipped. You are the ghost, collecting
 * soul orbs; the Muncher (a hungry pumpkin) hunts you. Grab a lantern and the Muncher panics:
 * touch it then to spook it back to its patch. Clear every orb for the next, faster level.
 * Client only; arrows / WASD move, Space restarts, Esc goes back to the console.
 */
public class GhostRushScreen extends Screen {
	private static final String[] MAZE = {
		"###################",
		"#o.......#.......o#",
		"#.##.###.#.###.##.#",
		"#.................#",
		"#.##.#.#####.#.##.#",
		"#....#...#...#....#",
		"####.###.#.###.####",
		"    .#...P...#.    ",
		"####.#.#####.#.####",
		"#........#........#",
		"#.##.###.#.###.##.#",
		"#o.#.....G.....#.o#",
		"#..#.#.#.#.#.#.#..#",
		"#....#...#...#....#",
		"###################"};
	private static final int W = MAZE[0].length(), H = MAZE.length;
	private static final int BG = 0xF00B0814, WALL = 0xFF231638, NEON = 0xFF8B5CF6, TEXT = 0xFFECE8F4, DIM = 0xFF8E84A6;
	private static final int PUMPKIN = 0xFFFF8A1F, PUMPKIN_DARK = 0xFFD9650B, SCARED = 0xFF3B82F6, GHOST = 0xFFF2EEFF;
	private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
	private static int best;

	private enum State { READY, PLAYING, CAUGHT, CLEAR, OVER }

	private static final class Mover {
		double x, y;
		int dx, dy, wantX, wantY;
		final int homeX, homeY;
		int scaredTicks, waitTicks;

		Mover(int x, int y) {
			this.homeX = x;
			this.homeY = y;
			reset();
		}

		void reset() {
			x = homeX;
			y = homeY;
			dx = dy = wantX = wantY = 0;
			scaredTicks = 0;
		}
	}

	private final Screen parent;
	private final Random random = new Random();
	private final char[][] tiles = new char[H][W];
	private Mover ghost;
	private final List<Mover> munchers = new ArrayList<>();
	private State state = State.READY;
	private int level = 1, lives = 3, score, orbsLeft, stateTicks, ticks, combo;

	public GhostRushScreen(Screen parent) {
		super(Component.literal("Ghost Rush"));
		this.parent = parent;
		newGame();
	}

	private void newGame() {
		level = 1;
		lives = 3;
		score = 0;
		loadLevel();
	}

	private void loadLevel() {
		orbsLeft = 0;
		munchers.clear();
		for (int y = 0; y < H; y++) {
			for (int x = 0; x < W; x++) {
				char c = MAZE[y].charAt(x);
				if (c == 'G') ghost = new Mover(x, y);
				if (c == 'P') munchers.add(new Mover(x, y));
				tiles[y][x] = c == 'G' || c == 'P' ? ' ' : c;
				if (c == '.' || c == 'o') orbsLeft++;
			}
		}
		// More munchers on later levels, each starting a little later.
		for (int i = 1; i < Math.min(3, 1 + (level - 1) / 2); i++) {
			Mover m = new Mover(munchers.get(0).homeX, munchers.get(0).homeY);
			m.waitTicks = 40 * i;
			munchers.add(m);
		}
		state = State.READY;
		stateTicks = 0;
	}

	private boolean open(int x, int y) {
		return y >= 0 && y < H && tiles[y][Math.floorMod(x, W)] != '#';
	}

	// ---------------------------------------------------------------- game loop

	@Override
	public void tick() {
		ticks++;
		stateTicks++;
		switch (state) {
			case PLAYING -> play();
			case CAUGHT -> {
				if (stateTicks < 30) return;
				if (lives <= 0) {
					state = State.OVER;
					best = Math.max(best, score);
				} else {
					ghost.reset();
					for (Mover m : munchers) m.reset();
					state = State.READY;
				}
				stateTicks = 0;
			}
			case CLEAR -> {
				if (stateTicks >= 40) {
					level++;
					loadLevel();
				}
			}
			default -> {}
		}
	}

	private void play() {
		move(ghost, 0.16, true);
		int gx = (int) Math.round(ghost.x), gy = (int) Math.round(ghost.y);
		char t = tiles[gy][Math.floorMod(gx, W)];
		if (t == '.' || t == 'o') {
			tiles[gy][Math.floorMod(gx, W)] = ' ';
			orbsLeft--;
			score += t == 'o' ? 50 : 10;
			if (t == 'o') {
				combo = 0;
				for (Mover m : munchers) m.scaredTicks = Math.max(60, 160 - level * 15);
			}
			if (orbsLeft == 0) {
				state = State.CLEAR;
				stateTicks = 0;
				best = Math.max(best, score);
				return;
			}
		}
		double speed = Math.min(0.15, 0.105 + level * 0.008);
		for (Mover m : munchers) {
			if (m.waitTicks > 0) {
				m.waitTicks--;
				continue;
			}
			if (m.scaredTicks > 0) m.scaredTicks--;
			move(m, m.scaredTicks > 0 ? speed * 0.6 : speed, false);
			double ddx = Math.abs(m.x - ghost.x), ddy = Math.abs(m.y - ghost.y);
			if (Math.min(ddx, W - ddx) < 0.6 && ddy < 0.6) {
				if (m.scaredTicks > 0) {
					score += 200 << Math.min(combo++, 3); // 200, 400, 800, 1600
					m.reset();
					m.waitTicks = 50;
				} else {
					lives--;
					state = State.CAUGHT;
					stateTicks = 0;
					return;
				}
			}
		}
	}

	/** Moves along the grid; turns only at tile centres. The player may reverse at any time. */
	private void move(Mover m, double speed, boolean player) {
		if (player && m.wantX == -m.dx && m.wantY == -m.dy && (m.wantX != 0 || m.wantY != 0)) {
			m.dx = m.wantX;
			m.dy = m.wantY;
		}
		double left = speed;
		for (int guard = 0; left > 1e-9 && guard < 4; guard++) {
			int cx = (int) Math.round(m.x), cy = (int) Math.round(m.y);
			boolean atCentre = Math.abs(m.x - cx) < 1e-6 && Math.abs(m.y - cy) < 1e-6;
			if (atCentre) {
				m.x = cx;
				m.y = cy;
				if (player) {
					if ((m.wantX != 0 || m.wantY != 0) && open(cx + m.wantX, cy + m.wantY)) {
						m.dx = m.wantX;
						m.dy = m.wantY;
					}
					if (!open(cx + m.dx, cy + m.dy)) {
						m.dx = m.dy = 0;
					}
				} else {
					int[] d = choose(m, cx, cy);
					m.dx = d[0];
					m.dy = d[1];
				}
				if (m.dx == 0 && m.dy == 0) return;
			}
			double next = m.dx > 0 ? Math.floor(m.x) + 1 : m.dx < 0 ? Math.ceil(m.x) - 1 : m.dy > 0 ? Math.floor(m.y) + 1 : Math.ceil(m.y) - 1;
			double dist = Math.abs(next - (m.dx != 0 ? m.x : m.y));
			double d = Math.min(left, dist);
			m.x += m.dx * d;
			m.y += m.dy * d;
			left -= d;
			if (Math.abs(d - dist) < 1e-9) {
				m.x = Math.round(m.x);
				m.y = Math.round(m.y);
			}
			// Tunnel: leave one side, come back on the other.
			if (m.x < -0.5) m.x += W;
			if (m.x > W - 0.5) m.x -= W;
		}
	}

	/** Muncher AI: hunt the ghost by maze distance (with some wandering early on), or flee when scared. */
	private int[] choose(Mover m, int cx, int cy) {
		int[][] dist = distancesFrom((int) Math.round(ghost.x), (int) Math.round(ghost.y));
		List<int[]> options = new ArrayList<>();
		for (int[] d : DIRS) if (open(cx + d[0], cy + d[1]) && !(d[0] == -m.dx && d[1] == -m.dy && (m.dx != 0 || m.dy != 0))) options.add(d);
		if (options.isEmpty()) return new int[] {-m.dx, -m.dy};
		if (m.scaredTicks == 0 && random.nextDouble() < Math.max(0.05, 0.3 - level * 0.05)) return options.get(random.nextInt(options.size()));
		int[] pick = options.get(0);
		int pickScore = Integer.MIN_VALUE;
		for (int[] d : options) {
			int v = dist[cy + d[1]][Math.floorMod(cx + d[0], W)];
			int s = m.scaredTicks > 0 ? v : -v;
			if (s > pickScore) {
				pickScore = s;
				pick = d;
			}
		}
		return pick;
	}

	private int[][] distancesFrom(int sx, int sy) {
		int[][] dist = new int[H][W];
		for (int[] row : dist) java.util.Arrays.fill(row, 999);
		ArrayDeque<int[]> queue = new ArrayDeque<>();
		sx = Math.floorMod(sx, W);
		dist[sy][sx] = 0;
		queue.add(new int[] {sx, sy});
		while (!queue.isEmpty()) {
			int[] p = queue.poll();
			for (int[] d : DIRS) {
				int nx = Math.floorMod(p[0] + d[0], W), ny = p[1] + d[1];
				if (!open(nx, ny) || dist[ny][nx] <= dist[p[1]][p[0]] + 1) continue;
				dist[ny][nx] = dist[p[1]][p[0]] + 1;
				queue.add(new int[] {nx, ny});
			}
		}
		return dist;
	}

	// ---------------------------------------------------------------- input

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();
		if (key == InputConstants.KEY_ESCAPE) {
			onClose();
			return true;
		}
		if (key == InputConstants.KEY_SPACE && (state == State.OVER)) {
			newGame();
			return true;
		}
		int[] d = switch (key) {
			case InputConstants.KEY_UP, InputConstants.KEY_W -> new int[] {0, -1};
			case InputConstants.KEY_DOWN, InputConstants.KEY_S -> new int[] {0, 1};
			case InputConstants.KEY_LEFT, InputConstants.KEY_A -> new int[] {-1, 0};
			case InputConstants.KEY_RIGHT, InputConstants.KEY_D -> new int[] {1, 0};
			default -> null;
		};
		if (d == null) return super.keyPressed(event);
		ghost.wantX = d[0];
		ghost.wantY = d[1];
		if (state == State.READY) {
			state = State.PLAYING;
			stateTicks = 0;
		}
		return true;
	}

	@Override
	public void onClose() {
		best = Math.max(best, score);
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
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float partial) {
		super.extractRenderState(g, mx, my, partial);
		int cell = Math.max(6, Math.min((width - 40) / W, (height - 64) / H));
		int ox = (width - cell * W) / 2, oy = (height - cell * H) / 2 + 10;

		g.centeredText(font, "GHOST RUSH", width / 2, oy - 26, 0xFFFF9A3C);
		g.text(font, "Score " + score, ox, oy - 12, TEXT, false);
		String right = "Level " + level + "   Best " + Math.max(best, score);
		g.text(font, right, ox + cell * W - font.width(right), oy - 12, TEXT, false);
		int lx = ox + font.width("Score " + score) + 10;
		for (int i = 0; i < lives; i++) drawGhost(g, lx + i * 12, oy - 14, 10, 1, 0, false);

		for (int y = 0; y < H; y++) {
			for (int x = 0; x < W; x++) {
				int px = ox + x * cell, py = oy + y * cell;
				char c = tiles[y][x];
				if (c == '#') {
					g.fill(px, py, px + cell, py + cell, WALL);
					// Neon edge wherever a wall meets a corridor.
					if (y > 0 && tiles[y - 1][x] != '#') g.fill(px, py, px + cell, py + 1, NEON);
					if (y < H - 1 && tiles[y + 1][x] != '#') g.fill(px, py + cell - 1, px + cell, py + cell, NEON);
					if (x > 0 && tiles[y][x - 1] != '#') g.fill(px, py, px + 1, py + cell, NEON);
					if (x < W - 1 && tiles[y][x + 1] != '#') g.fill(px + cell - 1, py, px + cell, py + cell, NEON);
				} else if (c == '.') {
					int r = Math.max(1, cell / 8), cx = px + cell / 2, cy = py + cell / 2;
					g.fill(cx - r, cy - r, cx + r, cy + r, 0xFFD8C8FF);
				} else if (c == 'o') {
					int r = Math.max(2, cell / 4), cx = px + cell / 2, cy = py + cell / 2;
					int glow = (ticks / 4) % 2 == 0 ? 0x66FF9A3C : 0x33FF9A3C;
					g.fill(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, glow);
					g.fill(cx - r, cy - r + 1, cx + r, cy + r, 0xFFFFB347);
					g.fill(cx - r + 1, cy - r - 1, cx + r - 1, cy - r + 1, 0xFF4A3F66);
				}
			}
		}

		for (Mover m : munchers) drawMuncher(g, ox + (int) Math.round(m.x * cell), oy + (int) Math.round(m.y * cell), cell, m);
		boolean caught = state == State.CAUGHT;
		if (!caught || (stateTicks / 3) % 2 == 0) {
			drawGhost(g, ox + (int) Math.round(ghost.x * cell), oy + (int) Math.round(ghost.y * cell), cell, ghost.dx, ghost.dy,
				munchers.stream().anyMatch(m -> m.scaredTicks > 0));
		}

		String banner = switch (state) {
			case READY -> "Press an arrow key or WASD";
			case CAUGHT -> "The Muncher got you!";
			case CLEAR -> "Level clear!";
			case OVER -> "Game over  ·  Space to play again";
			default -> null;
		};
		if (banner != null) {
			int bw = font.width(banner) + 16, by = oy + cell * 7 + cell / 2 - 6;
			g.fill(width / 2 - bw / 2, by - 3, width / 2 + bw / 2, by + 11, 0xE0140F1F);
			g.centeredText(font, banner, width / 2, by, state == State.OVER ? 0xFFFF6B6B : TEXT);
		}
		g.centeredText(font, "You're the ghost! Eat souls, dodge the Muncher, lanterns scare it.  Esc: back", width / 2, oy + cell * H + 6, DIM);
	}

	/** The player's ghost: round head, wavy hem, eyes looking where it goes. */
	private void drawGhost(GuiGraphicsExtractor g, int px, int py, int size, int dx, int dy, boolean powered) {
		int s = Math.max(6, size - 2), x0 = px + (size - s) / 2, y0 = py + (size - s) / 2;
		double r = s / 2.0;
		int bob = (ticks / 6) % 2;
		if (powered) g.fill(x0 - 1, y0 - 1 + bob, x0 + s + 1, y0 + s + 1 + bob, 0x558B5CF6);
		for (int row = 0; row < s; row++) {
			int y = y0 + row + bob;
			if (row < r) {
				double h = r - row - 0.5, half = Math.sqrt(Math.max(0, r * r - h * h));
				g.fill((int) Math.round(x0 + r - half), y, (int) Math.round(x0 + r + half), y + 1, GHOST);
			} else if (row < s - 2) {
				g.fill(x0, y, x0 + s, y + 1, GHOST);
			} else {
				int wave = Math.max(2, s / 4), shift = (ticks / 5) % 2;
				for (int x = 0; x < s; x++) if (((x / wave) + shift + (row == s - 1 ? 1 : 0)) % 2 == 0 || row == s - 2) g.fill(x0 + x, y, x0 + x + 1, y + 1, GHOST);
			}
		}
		int e = Math.max(1, s / 6), ey = y0 + bob + (int) (s * 0.35) + dy, lx = x0 + (int) (s * 0.28) + dx, rx = x0 + (int) (s * 0.62) + dx;
		g.fill(lx, ey, lx + e, ey + e + 1, 0xFF1A1428);
		g.fill(rx, ey, rx + e, ey + e + 1, 0xFF1A1428);
	}

	/** The Muncher: a pumpkin with a chomping mouth that faces where it goes; blue and shaky when scared. */
	private void drawMuncher(GuiGraphicsExtractor g, int px, int py, int cell, Mover m) {
		boolean scared = m.scaredTicks > 0;
		boolean blink = scared && m.scaredTicks < 40 && (ticks / 4) % 2 == 0;
		int body = scared ? (blink ? 0xFFF2EEFF : SCARED) : PUMPKIN, stripe = scared ? 0xFF2563EB : PUMPKIN_DARK;
		double r = cell * 0.46, cx = px + cell / 2.0 + (scared ? (ticks % 2) * 0.6 : 0), cy = py + cell / 2.0;
		double facing = m.dx > 0 ? 0 : m.dx < 0 ? Math.PI : m.dy > 0 ? Math.PI / 2 : m.dy < 0 ? -Math.PI / 2 : 0;
		double mouth = scared ? 0 : Math.abs(Math.sin(ticks * 0.45)) * 0.75;
		for (int y = (int) Math.floor(cy - r); y <= (int) Math.ceil(cy + r); y++) {
			for (int x = (int) Math.floor(cx - r); x <= (int) Math.ceil(cx + r); x++) {
				double ddx = x + 0.5 - cx, ddy = y + 0.5 - cy;
				if (ddx * ddx + ddy * ddy > r * r) continue;
				double a = Math.atan2(ddy, ddx) - facing;
				a = Math.atan2(Math.sin(a), Math.cos(a));
				if (Math.abs(a) < mouth) continue;
				boolean groove = Math.abs(ddx) < 0.8 || Math.abs(Math.abs(ddx) - r * 0.5) < 0.6;
				g.fill(x, y, x + 1, y + 1, groove ? stripe : body);
			}
		}
		int stem = Math.max(1, cell / 8);
		g.fill((int) cx - stem / 2, (int) (cy - r) - stem - 1, (int) cx + stem / 2 + 1, (int) (cy - r) + 1, scared ? 0xFF9CC4FF : 0xFF3F8F3A);
		int e = Math.max(1, cell / 7);
		int ex = (int) Math.round(cx + Math.cos(facing - 1.2) * r * 0.45), ey = (int) Math.round(cy + Math.sin(facing - 1.2) * r * 0.45);
		g.fill(ex, ey, ex + e, ey + e, scared ? 0xFFFFFFFF : 0xFF2A1405);
	}
}
