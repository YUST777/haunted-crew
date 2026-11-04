package dev.hauntedcrew.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.hauntedcrew.ConsolePayloads;
import dev.hauntedcrew.HauntedCrew;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.ModelLayerRegistry;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import dev.hauntedcrew.ScreenEntity;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.world.InteractionResult;
import net.minecraft.client.renderer.entity.EntityRenderers;
import net.minecraft.network.chat.Component;

public final class HauntedCrewClient implements ClientModInitializer {
	// Shows up in Options > Controls > Key Binds under "Haunted Crew", where players can rebind it.
	private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(HauntedCrew.id("main"));
	private static final KeyMapping OPEN_CONSOLE = KeyMappingHelper.registerKeyMapping(
		new KeyMapping("key.hauntedcrew.console", InputConstants.Type.KEYBOARD, InputConstants.KEY_K, CATEGORY));

	@Override
	public void onInitializeClient() {
		ModelLayerRegistry.registerModelLayer(GhostModel.LAYER, GhostModel::createLayer);
		EntityRenderers.register(HauntedCrew.GHOST, GhostRenderer::new);
		EntityRenderers.register(HauntedCrew.SCREEN, ScreenRenderer::new);
		ClientPlayNetworking.registerGlobalReceiver(ConsolePayloads.ScreenFrame.TYPE, (payload, context) -> ScreenTexture.update(payload.jpeg(), payload.url()));

		ClientPlayNetworking.registerGlobalReceiver(ConsolePayloads.ToClient.TYPE, (payload, context) -> ClientConsole.receive(payload.json()));
		// The Agent Console item opens the same screen as the key.
		UseItemCallback.EVENT.register((player, level, hand) -> {
			if (!level.isClientSide()) return InteractionResult.PASS;
			var item = player.getItemInHand(hand).getItem();
			if (item == HauntedCrew.AGENT_CONSOLE) openConsole();
			if (item == HauntedCrew.SCREEN_REMOTE && player.isShiftKeyDown()) Minecraft.getInstance().gui.setScreen(new BrowserScreen());
			return InteractionResult.PASS;
		});
		// Left-click with the remote: click the page where you look (sneak: scroll down). Never breaks blocks.
		AttackBlockCallback.EVENT.register((player, level, hand, pos, direction) -> {
			if (player.getItemInHand(hand).getItem() != HauntedCrew.SCREEN_REMOTE) return InteractionResult.PASS;
			if (level.isClientSide()) clickScreen(player);
			return InteractionResult.FAIL;
		});
		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (OPEN_CONSOLE.consumeClick()) {
				if (client.player == null || client.gui.screen() != null) continue;
				openConsole();
			}
		});
	}

	private static void clickScreen(net.minecraft.world.entity.player.Player player) {
		var eye = player.getEyePosition();
		var dir = player.getViewVector(1f);
		for (ScreenEntity e : player.level().getEntitiesOfClass(ScreenEntity.class, player.getBoundingBox().inflate(40))) {
			if (Math.abs(dir.z) < 1e-4) continue;
			double t = (e.getZ() - eye.z) / dir.z;
			if (t <= 0) continue;
			double hx = eye.x + dir.x * t, hy = eye.y + dir.y * t;
			double u = (hx - (e.getX() - e.width() / 2)) / e.width();
			double v = 1 - (hy - e.getY()) / e.height();
			if (u < 0 || u > 1 || v < 0 || v > 1) continue;
			if (player.isShiftKeyDown()) {
				ClientConsole.send("screen_scroll", null, "500", null, null);
				return;
			}
			ClientConsole.send("screen_click", null, String.format(java.util.Locale.ROOT, "%.4f,%.4f", u, v), null, null);
			// Open the panel so the keyboard goes to the page (e.g. after clicking a search box on the wall).
			Minecraft.getInstance().gui.setScreen(new BrowserScreen());
			return;
		}
	}

	private static void openConsole() {
		Minecraft client = Minecraft.getInstance();
		if (client.player == null) return;
		if (!ClientConsole.available()) {
			client.player.sendSystemMessage(Component.literal("Haunted Crew isn't installed on this server."));
			return;
		}
		ClientConsole.send("open", null, null, null, null);
		client.gui.setScreen(new ConsoleScreen());
	}
}
