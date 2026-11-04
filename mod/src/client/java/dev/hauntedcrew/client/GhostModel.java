package dev.hauntedcrew.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.hauntedcrew.CrewProtocol;
import dev.hauntedcrew.HauntedCrew;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.util.Mth;

/**
 * Ghost built from assets/hauntedcrew/models/entity/ghost.json, which tools/ghost/paint_ghost.py
 * generates from the Blender model. Parts named acc_<job>_* are only shown for that job.
 */
public class GhostModel extends EntityModel<GhostRenderState> {
	public static final ModelLayerLocation LAYER = new ModelLayerLocation(HauntedCrew.id("ghost"), "main");
	private static final String MODEL_PATH = "/assets/hauntedcrew/models/entity/ghost.json";

	private record Part(String name, String parent, float[] pivot, float[] rotation, float[] from, float[] size, int u, int v) {}

	private record Spec(int texWidth, int texHeight, List<Part> parts) {}

	private static Spec spec;

	private final ModelPart body;
	private final ModelPart leftArm;
	private final ModelPart rightArm;
	private final Map<ModelPart, CrewProtocol.Job> accessories = new HashMap<>();

	public GhostModel(ModelPart root) {
		super(root);
		Map<String, ModelPart> parts = new HashMap<>();
		for (Part p : spec().parts()) {
			ModelPart parent = p.parent() == null ? root : parts.get(p.parent());
			ModelPart part = parent.getChild(p.name());
			parts.put(p.name(), part);
			CrewProtocol.Job job = jobOf(p.name());
			if (job != null) accessories.put(part, job);
		}
		body = parts.get("body");
		leftArm = parts.get("left_arm");
		rightArm = parts.get("right_arm");
	}

	private static CrewProtocol.Job jobOf(String partName) {
		if (!partName.startsWith("acc_")) return null;
		for (CrewProtocol.Job job : CrewProtocol.Job.values()) {
			if (partName.startsWith("acc_" + job.name().toLowerCase() + "_")) return job;
		}
		return null;
	}

	public static LayerDefinition createLayer() {
		Spec s = spec();
		MeshDefinition mesh = new MeshDefinition();
		Map<String, PartDefinition> defs = new HashMap<>();
		for (Part p : s.parts()) {
			PartDefinition parent = p.parent() == null ? mesh.getRoot() : defs.get(p.parent());
			if (parent == null) throw new IllegalStateException("ghost model: parent " + p.parent() + " must come before " + p.name());
			CubeListBuilder cube = CubeListBuilder.create().texOffs(p.u(), p.v())
				.addBox(p.from()[0], p.from()[1], p.from()[2], p.size()[0], p.size()[1], p.size()[2]);
			PartPose pose = PartPose.offsetAndRotation(p.pivot()[0], p.pivot()[1], p.pivot()[2], p.rotation()[0], p.rotation()[1], p.rotation()[2]);
			defs.put(p.name(), parent.addOrReplaceChild(p.name(), cube, pose));
		}
		return LayerDefinition.create(mesh, s.texWidth(), s.texHeight());
	}

	private static synchronized Spec spec() {
		if (spec == null) spec = load();
		return spec;
	}

	private static Spec load() {
		try (InputStream in = GhostModel.class.getResourceAsStream(MODEL_PATH)) {
			if (in == null) throw new IllegalStateException("missing " + MODEL_PATH);
			JsonObject root = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
			JsonArray tex = root.getAsJsonArray("texture");
			List<Part> parts = new ArrayList<>();
			for (JsonElement e : root.getAsJsonArray("parts")) {
				JsonObject o = e.getAsJsonObject();
				JsonArray uv = o.getAsJsonArray("uv");
				parts.add(new Part(
					o.get("name").getAsString(),
					o.get("parent").isJsonNull() ? null : o.get("parent").getAsString(),
					floats(o, "pivot"), floats(o, "rotation"), floats(o, "from"), floats(o, "size"),
					uv.get(0).getAsInt(), uv.get(1).getAsInt()));
			}
			return new Spec(tex.get(0).getAsInt(), tex.get(1).getAsInt(), List.copyOf(parts));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	private static float[] floats(JsonObject o, String key) {
		JsonArray a = o.getAsJsonArray(key);
		return new float[] {a.get(0).getAsFloat(), a.get(1).getAsFloat(), a.get(2).getAsFloat()};
	}

	@Override
	public void setupAnim(GhostRenderState state) {
		super.setupAnim(state);
		for (Map.Entry<ModelPart, CrewProtocol.Job> e : accessories.entrySet()) e.getKey().visible = e.getValue() == state.job;

		float t = state.ageInTicks;
		body.y += Mth.sin(t * 0.1f) * 2.4f;
		// Working ghosts wave their arms; waiting ghosts raise one to get attention.
		if (state.status == CrewProtocol.Status.WORKING) {
			leftArm.xRot = Mth.sin(t * 0.6f) * 0.5f;
			rightArm.xRot = -Mth.sin(t * 0.6f + 1.5f) * 0.5f;
		} else if (state.status == CrewProtocol.Status.WAITING) {
			leftArm.zRot = -1.2f + Mth.sin(t * 0.3f) * 0.2f;
		}
	}
}
