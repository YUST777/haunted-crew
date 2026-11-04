package dev.hauntedcrew;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.Level;

/**
 * Hotbar tools. The Screen Remote cycles the big screen (right-click) and, client-side, types
 * (sneak + right-click) and clicks the page (left-click the wall). The Agent Console opens the chat.
 * Client behaviour lives in HauntedCrewClient so this class stays server-safe.
 */
public class CrewItem extends Item {
	public enum Kind { CONSOLE, REMOTE }

	private final Kind kind;

	public CrewItem(Properties properties, Kind kind) {
		super(properties);
		this.kind = kind;
	}

	@Override
	public InteractionResult use(Level level, Player player, InteractionHand hand) {
		if (kind == Kind.REMOTE && !player.isShiftKeyDown() && player instanceof ServerPlayer sp) HauntedCrew.cycleScreen(sp);
		return InteractionResult.SUCCESS;
	}
}
