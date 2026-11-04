package dev.hauntedcrew;

import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;

/**
 * Invisible anchor for the live browser picture on the big screen. Sits at the bottom centre of the
 * screen; clients draw the latest frame as a width x height quad facing south. Not saved.
 */
public class ScreenEntity extends Entity {
	private static final EntityDataAccessor<Float> WIDTH = SynchedEntityData.defineId(ScreenEntity.class, EntityDataSerializers.FLOAT);
	private static final EntityDataAccessor<Float> HEIGHT = SynchedEntityData.defineId(ScreenEntity.class, EntityDataSerializers.FLOAT);

	public ScreenEntity(EntityType<?> type, Level level) {
		super(type, level);
		noPhysics = true;
		setNoGravity(true);
	}

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		builder.define(WIDTH, 14.6f);
		builder.define(HEIGHT, 6.6f);
	}

	public float width() {
		return entityData.get(WIDTH);
	}

	public float height() {
		return entityData.get(HEIGHT);
	}

	public void setSize(float width, float height) {
		entityData.set(WIDTH, width);
		entityData.set(HEIGHT, height);
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		return false;
	}

	@Override
	protected void readAdditionalSaveData(ValueInput input) {}

	@Override
	protected void addAdditionalSaveData(ValueOutput output) {}
}
