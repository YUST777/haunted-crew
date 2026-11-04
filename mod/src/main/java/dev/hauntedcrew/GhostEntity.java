package dev.hauntedcrew;

import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;

/**
 * One Kiro agent session. Floats, passes through blocks, cannot be hurt or pushed.
 * Not saved with the world: the bridge's hello message recreates ghosts after a restart.
 */
public class GhostEntity extends PathfinderMob {
	public static final EntityDataAccessor<Integer> STATUS = SynchedEntityData.defineId(GhostEntity.class, EntityDataSerializers.INT);
	public static final EntityDataAccessor<Integer> JOB = SynchedEntityData.defineId(GhostEntity.class, EntityDataSerializers.INT);

	private static final double SPEED = 0.18;
	private static final double APPROACH_DISTANCE = 2.5;
	private static final double SEEK_PLAYER_RANGE = 32;

	private Vec3 home;

	public GhostEntity(EntityType<? extends GhostEntity> type, Level level) {
		super(type, level);
		setNoGravity(true);
		setSilent(true);
		noPhysics = true;
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Mob.createMobAttributes().add(Attributes.MAX_HEALTH, 20.0).add(Attributes.MOVEMENT_SPEED, 0.3);
	}

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		super.defineSynchedData(builder);
		builder.define(STATUS, CrewProtocol.Status.IDLE.ordinal());
		builder.define(JOB, CrewProtocol.Job.CODER.ordinal());
	}

	public CrewProtocol.Status status() {
		CrewProtocol.Status[] all = CrewProtocol.Status.values();
		int i = entityData.get(STATUS);
		return i >= 0 && i < all.length ? all[i] : CrewProtocol.Status.IDLE;
	}

	public void setStatus(CrewProtocol.Status status) {
		entityData.set(STATUS, status.ordinal());
	}

	public CrewProtocol.Job job() {
		CrewProtocol.Job[] all = CrewProtocol.Job.values();
		int i = entityData.get(JOB);
		return i >= 0 && i < all.length ? all[i] : CrewProtocol.Job.CODER;
	}

	public void setJob(CrewProtocol.Job job) {
		entityData.set(JOB, job.ordinal());
	}

	public void setHome(Vec3 home) {
		this.home = home;
	}

	@Override
	public void tick() {
		super.tick();
		if (level() instanceof ServerLevel server) moveServerSide(server);
	}

	// Waiting ghosts float over to the nearest player; everyone else returns to their desk.
	private void moveServerSide(ServerLevel level) {
		if (Guide.isGuide(this)) {
			Guide.idle(this, level);
			return;
		}
		Vec3 target = home;
		if (status() == CrewProtocol.Status.WAITING) {
			Player player = level.getNearestPlayer(this, SEEK_PLAYER_RANGE);
			if (player != null) {
				Vec3 toGhost = position().subtract(player.position());
				Vec3 offset = toGhost.lengthSqr() < 1e-4 ? new Vec3(1, 0, 0) : toGhost.normalize();
				target = player.position().add(offset.scale(APPROACH_DISTANCE)).add(0, 1.2, 0);
			}
		}
		if (target == null) return;
		Vec3 delta = target.subtract(position());
		double dist = delta.length();
		if (dist < 0.05) {
			setDeltaMovement(Vec3.ZERO);
			return;
		}
		Vec3 step = dist <= SPEED ? delta : delta.scale(SPEED / dist);
		setPos(position().add(step));
		if (dist > 0.3) {
			float yaw = (float) (Math.toDegrees(Math.atan2(-delta.x, delta.z)));
			setYRot(yaw);
			setYHeadRot(yaw);
			yBodyRot = yaw;
		}
	}

	@Override
	protected InteractionResult mobInteract(Player player, InteractionHand hand) {
		if (hand == InteractionHand.MAIN_HAND && Guide.isGuide(this)) {
			if (player instanceof ServerPlayer sp) Guide.talk(this, sp);
			return InteractionResult.SUCCESS;
		}
		return super.mobInteract(player, hand);
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		return false;
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	protected void doPush(Entity entity) {}

	@Override
	public boolean removeWhenFarAway(double distance) {
		return false;
	}

	@Override
	public boolean isAffectedByPotions() {
		return false;
	}
}
