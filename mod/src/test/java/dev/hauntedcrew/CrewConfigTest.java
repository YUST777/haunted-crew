package dev.hauntedcrew;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CrewConfigTest {
	@TempDir
	Path dir;

	@Test
	void createsDefaultConfigOwnerOnly() throws Exception {
		Path file = dir.resolve("config/hauntedcrew.json");
		CrewConfig cfg = CrewConfig.load(file);
		assertTrue(Files.exists(file));
		assertEquals("ws://127.0.0.1:8787/stream", cfg.bridgeUrl);
		if (Files.getFileStore(file).supportsFileAttributeView("posix")) {
			assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(file)));
		}
	}

	@Test
	void validation() {
		CrewConfig cfg = new CrewConfig();
		assertNotNull(cfg.validate(), "empty token must be rejected");
		cfg.viewToken = "t".repeat(43);
		assertNull(cfg.validate());
		cfg.bridgeUrl = "http://127.0.0.1:8787/stream";
		assertNotNull(cfg.validate());
		cfg.bridgeUrl = "ws://bad url";
		assertNotNull(cfg.validate());
	}

	@Test
	void flagsPlainWebSocketToRemoteHost() {
		CrewConfig cfg = new CrewConfig();
		assertFalse(cfg.insecureRemote());
		cfg.bridgeUrl = "ws://203.0.113.5:8080/stream";
		assertTrue(cfg.insecureRemote());
		cfg.bridgeUrl = "wss://crew.example.com/stream";
		assertFalse(cfg.insecureRemote());
	}

	@Test
	void roundTripsAnchor() throws Exception {
		Path file = dir.resolve("hauntedcrew.json");
		CrewConfig cfg = new CrewConfig();
		cfg.anchor = new CrewConfig.Anchor();
		cfg.anchor.x = 1.5;
		cfg.save(file);
		assertEquals(1.5, CrewConfig.load(file).anchor.x);
	}

	@Test
	void invalidJsonIsAnError() throws Exception {
		Path file = dir.resolve("hauntedcrew.json");
		Files.writeString(file, "{ nope");
		assertThrows(java.io.IOException.class, () -> CrewConfig.load(file));
	}
}
