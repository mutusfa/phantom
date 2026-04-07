import { describe, expect, test } from "bun:test";
import { detectInterventions } from "../intervention-detector.ts";

describe("detectInterventions", () => {
	describe("corrections", () => {
		test("detects classic correction phrases", () => {
			const user = ["actually, i meant the other endpoint", "thanks"];
			const asst = ["Sure, updating the main endpoint.", "Done."];
			const { corrections } = detectInterventions(user, asst);
			expect(corrections).toBe(1);
		});

		test("detects multiple corrections across messages", () => {
			const user = ["no, that's wrong", "actually, i meant X", "never mind"];
			const asst = ["Ok.", "Ok.", "Ok."];
			const { corrections } = detectInterventions(user, asst);
			expect(corrections).toBe(3);
		});

		test("case-insensitive matching", () => {
			const user = ["ACTUALLY, use the other one"];
			const { corrections } = detectInterventions(user, []);
			expect(corrections).toBe(1);
		});

		test("returns 0 when no corrections", () => {
			const user = ["looks good", "thanks", "perfect"];
			const asst = ["Done.", "Here it is.", "Fixed."];
			const { corrections } = detectInterventions(user, asst);
			expect(corrections).toBe(0);
		});

		test("detects 'don\\'t do that'", () => {
			const { corrections } = detectInterventions(["don't do that"], []);
			expect(corrections).toBe(1);
		});
	});

	describe("confirmations", () => {
		// The algorithm pairs asst[i] with user[i+1]: "did asst[i] ask a question
		// and did the next user message reply with a short affirmative?"
		test("detects short affirmative reply to a question", () => {
			// user[0] = initial request; asst[0] = unnecessary question; user[1] = short yes
			const asst = ["Should I proceed with the migration?", "Done."];
			const user = ["migrate the database please", "yes"];
			const { confirmations } = detectInterventions(user, asst);
			expect(confirmations).toBe(1);
		});

		test("does not count confirmation if assistant did not ask a question", () => {
			const asst = ["I updated the file.", "Done."];
			const user = ["make the change", "yes"];
			const { confirmations } = detectInterventions(user, asst);
			expect(confirmations).toBe(0);
		});

		test("does not count if user reply is long (likely a new instruction)", () => {
			const asst = ["Should I proceed with the migration?", "Done."];
			const user = ["run it", "yes please go ahead and run it against the staging db first"];
			const { confirmations } = detectInterventions(user, asst);
			// 12 words - not short enough to be a confirmation
			expect(confirmations).toBe(0);
		});

		test("counts multiple unnecessary confirmations", () => {
			// i=0: asst[0] ends with ?, user[1]="go ahead" → affirmative
			// i=1: asst[1] ends with ?, user[2]="yes" → affirmative
			const asst = ["Shall I delete the old file?", "Should I push now?", "Done."];
			const user = ["clean up the repo", "go ahead", "yes"];
			const { confirmations } = detectInterventions(user, asst);
			expect(confirmations).toBe(2);
		});

		test("returns 0 when messages are empty", () => {
			const { corrections, confirmations } = detectInterventions([], []);
			expect(corrections).toBe(0);
			expect(confirmations).toBe(0);
		});
	});

	describe("independence", () => {
		test("corrections and confirmations are counted independently", () => {
			// asst[0] doesn't ask a question, so no confirmation even though user[1]="ok"
			const asst = ["Here's the result.", "Done."];
			const user = ["actually, no", "ok"];
			const result = detectInterventions(user, asst);
			expect(result.corrections).toBe(1);
			expect(result.confirmations).toBe(0);
		});
	});
});
