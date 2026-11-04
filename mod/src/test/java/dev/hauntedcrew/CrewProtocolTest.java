package dev.hauntedcrew;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class CrewProtocolTest {
	@Test
	void parsesHelloSessions() {
		var msg = CrewProtocol.parse("""
			{"type":"hello","role":"view","history":[],"sessions":[
			  {"session":"abc123456","status":"working","lastKind":"tool_start","category":"read","file":"src/x.ts"},
			  {"status":"working"},
			  "junk"
			]}""");
		var hello = assertInstanceOf(CrewProtocol.Hello.class, msg);
		assertEquals(1, hello.sessions().size());
		var s = hello.sessions().getFirst();
		assertEquals(CrewProtocol.Status.WORKING, s.status());
		assertEquals("reading src/x.ts", s.activity());
		assertEquals("Ghost abc123", s.label());
	}

	@Test
	void eventUpdatesAndSessionEnd() {
		var update = CrewProtocol.parse("""
			{"type":"event","event":{"kind":"stop","session":"s1"},"session":{"session":"s1","status":"waiting","agent":"Coder"}}""");
		var s = assertInstanceOf(CrewProtocol.Update.class, update).session();
		assertEquals("Coder", s.label());
		assertEquals("waiting for you", s.activity());

		var end = CrewProtocol.parse("""
			{"type":"event","event":{"kind":"session_end","session":"s1"},"session":null}""");
		assertEquals("s1", assertInstanceOf(CrewProtocol.SessionEnded.class, end).id());
	}

	@Test
	void stripsFormattingCodesAndCapsLength() {
		var msg = CrewProtocol.parse("{\"type\":\"event\",\"event\":{\"kind\":\"tool_start\"},\"session\":{\"session\":\"s\",\"agent\":\"§kEvil\u0007"
			+ "x".repeat(200) + "\"}}");
		var s = assertInstanceOf(CrewProtocol.Update.class, msg).session();
		assertFalse(s.agent().contains("§"));
		assertFalse(s.agent().contains("\u0007"));
		assertTrue(s.agent().length() <= 80);
	}

	@Test
	void unknownStatusIsIdleAndUnknownTypeIgnored() {
		var msg = CrewProtocol.parse("{\"type\":\"event\",\"event\":{},\"session\":{\"session\":\"s\",\"status\":\"zombie\"}}");
		assertEquals(CrewProtocol.Status.IDLE, assertInstanceOf(CrewProtocol.Update.class, msg).session().status());
		assertNull(CrewProtocol.parse("{\"type\":\"other\"}"));
	}

	@Test
	void jobFromAgentName() {
		assertEquals(CrewProtocol.Job.PLANNER, CrewProtocol.Job.fromName("Spec Planner"));
		assertEquals(CrewProtocol.Job.TESTER, CrewProtocol.Job.fromName("qa-bot"));
		assertEquals(CrewProtocol.Job.REVIEWER, CrewProtocol.Job.fromName("Code Reviewer"));
		assertEquals(CrewProtocol.Job.DOCS, CrewProtocol.Job.fromName("Docs"));
		assertEquals(CrewProtocol.Job.RESEARCHER, CrewProtocol.Job.fromName("Researcher"));
		assertEquals(CrewProtocol.Job.CODER, CrewProtocol.Job.fromName("Coder"));
		assertNull(CrewProtocol.Job.fromName("Ghost abc123"));
		assertNull(CrewProtocol.Job.fromName(null));
	}

	@Test
	void feedLinesAndPermissions() {
		var msg = CrewProtocol.parse("""
			{"type":"event",
			 "event":{"kind":"permission","session":"s1","agent":"Coder","ts":5,"request":{"id":"r1","title":"Edit app.ts","options":[{"id":"allow","name":"Allow"}]}},
			 "session":{"session":"s1","agent":"Coder","status":"waiting","console":true,
			            "permission":{"id":"r1","title":"Edit app.ts","options":[{"id":"allow","name":"Allow"},{"id":"reject","name":"Reject"}]}}}""");
		var u = assertInstanceOf(CrewProtocol.Update.class, msg);
		assertTrue(u.session().console());
		assertEquals("needs your approval", u.session().activity());
		assertEquals(2, u.session().permission().options().size());
		assertEquals("asked to Edit app.ts", u.line().text());
		assertEquals(5, u.line().ts());

		var ok = CrewProtocol.parse("{\"type\":\"event\",\"event\":{\"kind\":\"tool_end\",\"session\":\"s1\",\"ok\":true},\"session\":{\"session\":\"s1\"}}");
		assertNull(assertInstanceOf(CrewProtocol.Update.class, ok).line(), "successful tool ends are not feed noise");

		var hello = CrewProtocol.parse("""
			{"type":"hello","sessions":[],"history":[
			  {"kind":"tool_start","session":"s1","category":"read","file":"a.ts"},
			  {"kind":"message","session":"s1","text":"All done."},
			  {"kind":"bogus","session":"s1"}]}""");
		var lines = assertInstanceOf(CrewProtocol.Hello.class, hello).lines();
		assertEquals(2, lines.size());
		assertEquals("reading a.ts", lines.get(0).text());
		assertEquals("All done.", lines.get(1).text());
	}

	@Test
	void agentRepliesKeepLineBreaks() {
		var msg = CrewProtocol.parse("{\"type\":\"event\",\"event\":{\"kind\":\"message\",\"session\":\"s\",\"text\":\"Hi!\\n\\n\\n\\n- one\\u0007\\n- two\"},\"session\":{\"session\":\"s\"}}");
		assertEquals("Hi!\n\n- one \n- two", assertInstanceOf(CrewProtocol.Update.class, msg).line().text());
	}

	@Test
	void rejectsMalformed() {
		assertThrows(IllegalArgumentException.class, () -> CrewProtocol.parse("not json {"));
		assertThrows(IllegalArgumentException.class, () -> CrewProtocol.parse("[1,2]"));
	}
}
