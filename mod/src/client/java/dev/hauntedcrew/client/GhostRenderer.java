package dev.hauntedcrew.client;

import dev.hauntedcrew.GhostEntity;
import dev.hauntedcrew.HauntedCrew;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.Identifier;

public class GhostRenderer extends MobRenderer<GhostEntity, GhostRenderState, GhostModel> {
	private static final Identifier TEXTURE = HauntedCrew.id("textures/entity/ghost.png");

	public GhostRenderer(EntityRendererProvider.Context context) {
		super(context, new GhostModel(context.bakeLayer(GhostModel.LAYER)), 0.3f);
	}

	@Override
	public GhostRenderState createRenderState() {
		return new GhostRenderState();
	}

	@Override
	public void extractRenderState(GhostEntity ghost, GhostRenderState state, float partialTick) {
		super.extractRenderState(ghost, state, partialTick);
		state.status = ghost.status();
		state.job = ghost.job();
	}

	// The model is authored at 2x size (1 unit = 1/32 block) for double pixel density.
	@Override
	protected void scale(GhostRenderState state, PoseStack poseStack) {
		poseStack.scale(0.5f, 0.5f, 0.5f);
	}

	@Override
	public Identifier getTextureLocation(GhostRenderState state) {
		return TEXTURE;
	}

	// Body tint matches the status colour: blue working, yellow waiting, red error, grey idle.
	@Override
	protected int getModelTint(GhostRenderState state) {
		return switch (state.status) {
			case WORKING -> 0xFFE4ECFF;
			case WAITING -> 0xFFFFF4C8;
			case ERROR -> 0xFFFFCCCC;
			case IDLE -> 0xFFE2E2E2;
		};
	}
}
