/**
 * Heuristic detection of user corrections and unnecessary confirmation requests.
 *
 * Imprecise by design - the goal is directional signal, not precision.
 * Constitution principle 9 locks this sensitivity: it cannot be reduced
 * by the evolution engine to inflate intervention scores.
 */

// Phrases that signal the user is redirecting or correcting Phantom
const CORRECTION_SIGNALS = [
	"no,",
	"nope",
	"wait,",
	"actually,",
	"actually -",
	"that's wrong",
	"that's not",
	"not quite",
	"you missed",
	"incorrect",
	"doesn't make sense",
	"i meant",
	"that doesn't make sense",
	"that's incorrect",
	"please don't",
	"don't do that",
	"wrong direction",
	"not what i",
	"that's not right",
	"you got it wrong",
	"f it",
	"forget it",
	"never mind",
];

// Short affirmative replies that suggest user was just answering Phantom's question
const SHORT_AFFIRMATIVES = [
	"yes",
	"yeah",
	"yep",
	"yup",
	"sure",
	"ok",
	"okay",
	"correct",
	"exactly",
	"go ahead",
	"proceed",
	"do it",
	"that's right",
	"right",
	"fine",
	"sounds good",
	"good",
];

export type InterventionCounts = {
	corrections: number;
	confirmations: number;
};

/**
 * Counts corrections and unnecessary confirmation requests in a conversation.
 *
 * @param userMessages   Ordered list of user messages in the session
 * @param assistantMessages  Ordered list of assistant messages in the session
 */
export function detectInterventions(userMessages: string[], assistantMessages: string[]): InterventionCounts {
	let corrections = 0;
	let confirmations = 0;

	for (const msg of userMessages) {
		const lower = msg.toLowerCase();
		if (CORRECTION_SIGNALS.some((signal) => lower.includes(signal))) {
			corrections++;
		}
	}

	// Confirmation requests: Phantom asked a question, user replied with short affirmative.
	// Use min(assistant, user) length to pair messages approximately.
	const pairCount = Math.min(assistantMessages.length, userMessages.length);
	for (let i = 0; i < pairCount - 1; i++) {
		const asstMsg = assistantMessages[i] ?? "";
		if (!asstMsg.trimEnd().endsWith("?")) continue;

		// Check that the question is the *last* sentence (not just mid-paragraph punctuation)
		const sentences = asstMsg.split(/[.!?]/).filter(Boolean);
		const lastSentence = sentences[sentences.length - 1] ?? "";
		if (!lastSentence.trim().endsWith("?") && !asstMsg.trimEnd().endsWith("?")) continue;

		const nextUser = userMessages[i + 1] ?? "";
		const wordCount = nextUser.trim().split(/\s+/).filter(Boolean).length;
		const isShort = wordCount <= 6;
		const lower = nextUser.toLowerCase();
		const isAffirmative = SHORT_AFFIRMATIVES.some((a) => lower.includes(a));

		if (isShort && isAffirmative) {
			confirmations++;
		}
	}

	return { corrections, confirmations };
}
