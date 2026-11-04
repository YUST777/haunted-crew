package dev.hauntedcrew.client;

import dev.hauntedcrew.CrewProtocol;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;

public class GhostRenderState extends LivingEntityRenderState {
	public CrewProtocol.Status status = CrewProtocol.Status.IDLE;
	public CrewProtocol.Job job = CrewProtocol.Job.CODER;
}
