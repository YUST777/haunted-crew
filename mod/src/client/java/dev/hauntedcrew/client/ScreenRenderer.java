package dev.hauntedcrew.client;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.hauntedcrew.ScreenEntity;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.util.LightCoordsUtil;

/** Draws the latest browser frame as a full-bright quad over the big screen, facing south. */
public class ScreenRenderer extends EntityRenderer<ScreenEntity, ScreenRenderer.State> {
	public static class State extends EntityRenderState {
		float width, height;
	}

	public ScreenRenderer(EntityRendererProvider.Context context) {
		super(context);
	}

	@Override
	public State createRenderState() {
		return new State();
	}

	@Override
	public void extractRenderState(ScreenEntity entity, State state, float partialTick) {
		super.extractRenderState(entity, state, partialTick);
		state.width = entity.width();
		state.height = entity.height();
	}

	// The entity is tiny but the picture is 15 blocks wide: never cull it by its own box.
	@Override
	public boolean shouldRender(ScreenEntity entity, Frustum frustum, double x, double y, double z, float partialTick) {
		return true;
	}

	@Override
	public void submit(State state, PoseStack poseStack, SubmitNodeCollector collector, CameraRenderState camera) {
		if (!ScreenTexture.ready()) return;
		float hw = state.width / 2, h = state.height;
		collector.submitCustomGeometry(poseStack, RenderTypes.entitySolid(ScreenTexture.ID), (pose, v) -> {
			vertex(v, pose, -hw, 0, 0, 1);
			vertex(v, pose, hw, 0, 1, 1);
			vertex(v, pose, hw, h, 1, 0);
			vertex(v, pose, -hw, h, 0, 0);
		});
	}

	private static void vertex(com.mojang.blaze3d.vertex.VertexConsumer v, PoseStack.Pose pose, float x, float y, float u, float vv) {
		v.addVertex(pose, x, y, 0).setColor(-1).setUv(u, vv).setOverlay(OverlayTexture.NO_OVERLAY).setLight(LightCoordsUtil.FULL_BRIGHT).setNormal(pose, 0, 0, 1);
	}
}
