# -*- coding: utf-8 -*-
"""Generate distractor explanations for Praxis 5002 items 001-072 (chunk-A).
Each value list is aligned to the item's `choices` array in order;
the correct answer's slot is skipped when building output.
"""
import json, os

SRC = "E:/Triumph/praxis-5001/content-infra/items-5000-series.jsonl"
OUT = "E:/Triumph/praxis-5001/drafts/distractor-5002/chunk-A.jsonl"

# id -> [exp for choices[0], exp for choices[1], exp for choices[2], exp for choices[3]]
# (entry for the correct answer is a placeholder and gets filtered out)
EXPL = {
"5002-001": [
 None,
 "Reads 'reasons' as causal links; cause and effect explains why events happen, not a topic's supporting details.",
 "Equates supporting details with solutions; this structure centers on a problem and its fixes, not a topic's attributes.",
 "Assumes listing means ordering; sequence arranges events or steps in time, which the stem never mentions."],
"5002-002": [
 "Looks for 'like' or 'as' and finds none; the passage never makes an explicit comparison between unlike things.",
 None,
 "Assumes the imagery is sound-based; no word imitates a sound, and the device at work is attributing human traits.",
 "Treats 'scar of consumption' as pure exaggeration; the phrasing grants the caterpillar deliberate, persistent intent instead."],
"5002-003": [
 "Relies on practice alone with no modeling; worksheets assess the skill but never demonstrate how to find a main idea.",
 "Treats knowing a definition as having the skill; students can recite the term yet still fail to identify one in text.",
 None,
 "Mistakes marking everything for analysis; underlining every sentence gives no criteria for judging which point matters most."],
"5002-004": [
 "Overstates a caption's scope; captions explain one visual, not the whole chapter's content.",
 "Confuses text features; source lists belong in a bibliography or references section, not beneath a photograph.",
 "Confuses front-matter with captions; a table of contents maps chapters, while a caption sits with its image.",
 None],
"5002-005": [
 None,
 "Calls the phrase a clause; it contains no subject and verb, so it cannot be a dependent clause modifying anything.",
 "Overlooks that no preposition opens the phrase; 'a treasure trove of scrolls' renames the library as a noun phrase.",
 "Assumes a second action; the phrase names a thing rather than describing actions, so no predicate exists."],
"5002-006": [
 "Labels the sentence emotional imagery; no vivid sensory detail appears, and the point is the intention-outcome gap.",
 None,
 "Sees persuasion where none exists; the sentence presents no claims or evidence, only an ironic reversal.",
 "Reads the sentence as a timeline; it reports no sequence of events but a contrast between intention and result."],
"5002-007": [
 "Targets decoding, which is already accurate; the student's gaps are in prosody and comprehension, not word recognition.",
 "Raises difficulty when the student cannot yet read accessible text expressively; harder passages deepen the gap.",
 None,
 "Extends the same unexpressive silent habits; without modeling and oral practice, fluency and recall do not improve."],
"5002-008": [
 "Creates a comma splice; a comma alone cannot join two independent clauses without a coordinating conjunction.",
 "Confuses possession with clause joining; an apostrophe marks ownership or contraction, never separates clauses.",
 "Misapplies a colon; colons introduce lists or explanations rather than linking two related statements as equals.",
 None],
"5002-009": [
 None,
 "Mistakes informational content for amusement; the passage presents knowledge about controlled burning, not a story.",
 "Reads a call to action into description; the passage shares information and does not urge readers to relocate.",
 "Overstates the author's stance; presenting traditional practices is not the same as attacking every modern policy."],
"5002-010": [
 "Reads the sentence as fact; the inverted conditional signals the opposite, since the success never happened.",
 None,
 "Reverses the implication; 'Had ... acted sooner' concedes that the action did not come early enough.",
 "Finds doubt in the wrong place; the sentence implies regret about inaction, not uncertainty about scheduling."],
"5002-011": [
 "Lowers the text instead of scaffolding access; simplified texts block grade-level content and language growth.",
 "Removes every support; silent reading alone leaves unknown vocabulary and structures unexplained.",
 None,
 "Substitutes listening for reading; without seeing the text, students miss word-level exposure and decoding practice."],
"5002-012": [
 "Matches genre to factuality incorrectly; both facts and opinions can appear in textbooks or in editorials.",
 "Ties the difference to length; fact versus opinion is about verifiability, not sentence size.",
 "Denies the distinction entirely; the core test is whether a statement can be verified or expresses a judgment.",
 None],
"5002-013": [
 None,
 "Confuses contrast with result; 'therefore' signals a conclusion that follows from a previous idea.",
 "Chooses an additive transition; 'additionally' stacks ideas rather than setting them against each other.",
 "Confuses contrast with consequence; 'consequently' shows a cause-and-effect link, not an opposing one."],
"5002-014": [
 "Dismisses the confusion instead of modeling strategy use; calling poems hard offers no move toward understanding.",
 None,
 "Substitutes rote recall for thinking aloud; memorizing an idea bypasses the rereading and questioning that matter.",
 "Defers help outside the lesson; the teachable moment for modeling comprehension strategies is in the classroom."],
"5002-015": [
 "Swaps the labels; 'un' is the prefix and 'happy' is the root, with only '-ness' functioning as a suffix.",
 "Cuts the word at non-morpheme boundaries; 'unh,' 'a,' and 'piness' are not meaningful English units.",
 None,
 "Attaches the wrong letters to the prefix; 'una' is not a morpheme, while 'un-' alone is."],
"5002-016": [
 "Swaps both homophones; 'There' cannot act as the subject's contraction, and 'their done' misuses the possessive.",
 "Drops the apostrophe in 'Theyre' and then misuses 'there' where the contraction 'they're' is required.",
 "Uses the possessive 'Their' where the contraction is needed and omits the apostrophe in 'theyre'.",
 None],
"5002-017": [
 None,
 "Keeps a comma splice; a comma alone still leaves two independent clauses improperly joined.",
 "Mangles the meaning by making 'the students' a direct object; the comma placement separates nothing correctly.",
 "Inserts a comma inside the first clause; a comma never belongs between a subject and its verb."],
"5002-018": [
 "Gives a verdict without direction; circling errors shows what is wrong but not how to build a specific claim.",
 None,
 "Removes the student's ownership; copying a teacher-written thesis skips the thinking that revision requires.",
 "Accepts a vague thesis; 'many things happened' names no specific claim and gives the essay nothing to prove."],
"5002-019": [
 "Reverses the two definitions; form describes a word's structure, while function describes its role, not its spelling.",
 "Limits both terms to single parts of speech; every word class has both a form and a role in a sentence.",
 None,
 "Collapses two distinct concepts; a word's structure can differ from its role, as when a noun functions adjectivally."],
"5002-020": [
 "Confuses outlining with vocabulary work; outlines map essay ideas, not word lists.",
 "Expects grammar polishing at the planning stage; outlines arrange ideas before any sentences are drafted.",
 "Treats the outline as the finished process; it is a planning tool that precedes, not replaces, drafting.",
 None],
"5002-021": [
 None,
 "Limits feedback to praise; compliments feel safe but give the writer nothing specific to revise.",
 "Removes structure entirely; without criteria, students default to vague or purely personal reactions.",
 "Turns review into proofreading; hunting surface errors ignores the content and organization feedback that matters."],
"5002-022": [
 "Keeps the passive construction; 'several discrepancies were found' still names no agent performing the review.",
 None,
 "Reorders the clauses without adding a subject; 'several discrepancies' still cannot perform the reviewing.",
 "Overlooks the faulty modifier; with no subject acting, 'upon further review' attaches to nothing in the sentence."],
"5002-023": [
 "Confuses length with structure; paragraph quality depends on unity and development, not a sentence count.",
 "Applies research-paper rules to every paragraph; quotes may support evidence but are not required in each one.",
 None,
 "Equates fancy diction with quality; clear, appropriate word choice serves a paragraph better than complexity."],
"5002-024": [
 "Invents a clause-count rule; the distinction rests on punctuation, not on how many clauses appear.",
 "Treats the terms as interchangeable; a comma splice is a specific run-on type that joins clauses with a comma.",
 "Judges by length; a short sentence with two unpunctuated clauses is still a run-on.",
 None],
"5002-025": [
 None,
 "Dismisses a real pattern; articles affect meaning, and these systematic errors deserve targeted attention.",
 "Overloads the writer with every rule at once; focusing on one pattern makes practice manageable and transferable.",
 "Buries the message under corrections; marking every error before responding to ideas discourages the writer."],
"5002-026": [
 "Mixes conventions; the British-style plural verb 'are' clashes with the singular possessive 'its.'",
 None,
 "Applies British plural agreement; American usage treats 'team' as singular, taking 'is' and 'its.'",
 "Pairs a singular verb with a plural pronoun; if 'team' is singular, the pronoun must be 'its.'"],
"5002-027": [
 "Confuses the introduction with an abstract; one sentence cannot hook readers, give background, and state a thesis.",
 "Reverses the essay's order; conclusions echo introductions, but introductions are written to lead in.",
 None,
 "Confuses the introduction with a works-cited page; sources belong at the end in formal citations."],
"5002-028": [
 "Opens a fresh topic at the end; conclusions synthesize the essay's argument rather than raise new questions.",
 "Merely lists topics and stops; 'That is all' adds no synthesis, insight, or sense of closure.",
 "Restates a body-point claim without wrapping up; a strong conclusion looks back on the whole argument.",
 None],
"5002-029": [
 None,
 "Switches to gerunds without keeping the infinitive frame; 'told the players to ...' requires matching 'to' phrases.",
 "Replaces the infinitive series with bare commands, changing the sentence's grammar instead of fixing parallelism.",
 "Misses the broken parallelism; 'they should shoot' shifts from infinitive phrases to a full clause mid-series."],
"5002-030": [
 "Overstates transitions' role; they connect ideas but cannot state a paragraph's controlling point.",
 None,
 "Judges transitions by word count; they exist to show logic, not to pad length.",
 "Treats transitions as ornament; each one carries a precise logical relationship such as contrast or cause."],
"5002-031": [
 "Reduces the main idea to the title; titles hint at the topic but rarely capture the author's full point.",
 "Assumes the main idea is always stated first; it may appear anywhere or be implied across the passage.",
 None,
 "Confuses a supporting detail with the central point; details back up the main idea rather than define it."],
"5002-032": [
 "Undermines credibility; overstatement invites skepticism instead of trust.",
 "Weakens persuasion; acknowledging and refuting counterarguments signals fairness and strengthens ethos.",
 "Relies only on pathos; emotion without evidence or expertise fails to establish the writer as trustworthy.",
 None],
"5002-033": [
 None,
 "Removes all scaffolds; silent independent reading leaves vocabulary and structure gaps unaddressed.",
 "Denies access to grade-level reading entirely; English learners need targeted support, not exclusion.",
 "Substitutes easier texts for scaffolding; simplification lowers rigor instead of supporting access to content."],
"5002-034": [
 "Confuses the topic sentence with a concluding sentence; its role is to open the paragraph's line of thought.",
 None,
 "Confuses paragraph structure with documentation; sources belong in citations, not in the topic sentence.",
 "Applies narrative conventions to all paragraphs; a topic sentence states a point, not scenery."],
"5002-035": [
 "Confuses structure with a narrative arc; this pattern centers on an issue and its fixes, not on time order.",
 "Mistakes similarity analysis for sequencing; this structure examines likeness and difference between subjects.",
 None,
 "Confuses causal explanation with time order; this structure explains why events happen, not when."],
"5002-036": [
 "Misreads the tone; 'dominated' and the sentinel imagery suggest imposing watchfulness, not warmth.",
 "Focuses on 'gray' as the point; the color word is detail, while the device is the comparison to watchful guards.",
 "Takes the comparison as literal description; the phrase is figurative, suggesting vigilance rather than soldiers.",
 None],
"5002-037": [
 None,
 "Merely shortens the text; a summary selects the most important ideas rather than compressing every detail.",
 "Mistakes topic sentences for a summary; stitching first sentences misses ideas the author implies across paragraphs.",
 "Makes brevity the only goal; an over-short summary can omit the essential ideas that define the passage."],
"5002-038": [
 "Ties genre to length; both fiction and nonfiction come in every length from brief piece to book.",
 None,
 "Judges by illustration; both genres may include pictures, so artwork cannot define the category.",
 "Erases the defining line; fiction is invented while nonfiction reports verifiable facts about the real world."],
"5002-039": [
 "Skips the in-text skill; looking up definitions without using context fails to build independent word-solving.",
 "Defers to an outside source; asking others solves this word once but teaches no transferable strategy.",
 None,
 "Abandons the word entirely; skipping leaves a key science term unknown, creating a gap in comprehension."],
"5002-040": [
 "Drops the expectation to ground claims; without accountability, students offer opinions without citing the text.",
 "Mistakes structurelessness for rigor; unstructured talk rarely requires students to quote specific passages.",
 "Puts the teacher between students and text; lecturing models citation but never requires students to produce it.",
 None],
"5002-041": [
 None,
 "Defines alliteration, not metaphor; sound repetition is a phonological device unrelated to comparison.",
 "Defines hyperbole; metaphor compares two unlike things rather than overstating a fact.",
 "Defines a rhetorical question; metaphor states that one thing is another to draw an implicit comparison."],
"5002-042": [
 "Mistakes effect for purpose; irony asks readers to notice a contrast, not to lose the thread of the story.",
 None,
 "Confuses subtlety with irony; irony depends on a gap between expectation and outcome, not on withholding themes.",
 "Treats irony as padding; it is a meaning-making device, not a device for extending length."],
"5002-043": [
 "Treats speed as the cause; the error is a phonics gap in the 'ough' pattern, not carelessness.",
 "Relies on repetition without instruction; copying one word builds familiarity but teaches nothing about the pattern.",
 None,
 "Avoids the teaching point; the word will recur, and dodging it leaves the underlying phonics gap unaddressed."],
"5002-044": [
 "Confuses closure with copying; conclusions restate key points in fresh language, not verbatim repetition.",
 "Breaks closure; new content belongs in the body, where it can be developed and supported.",
 "Scatters unrelated details; a conclusion synthesizes the text's key points into one cohesive close.",
 None],
"5002-045": [
 None,
 "Confuses two small marks; commas separate elements, while apostrophes signal ownership or contraction.",
 "Chooses an end-stop; periods end sentences and have no possessive function.",
 "Confuses clause punctuation with possession; semicolons join related independent clauses."],
"5002-046": [
 "Offers opinion, not evidence; 'uniforms are nice' is a preference that cannot be verified or measured.",
 None,
 "Shows compliance, not impact; a photo proves students wear uniforms, not that distractions decreased.",
 "Raises an unrelated objection; cost concerns the budget and never addresses distraction in the claim."],
"5002-047": [
 "Tests encoding, not comprehension; spelling measures neither inference nor understanding of a text.",
 "Checks surface recognition; naming the author requires no reading between the lines.",
 None,
 "Tests literal memory; a directly stated fact requires retrieval, not inference beyond the text."],
"5002-048": [
 "Confuses dialogue with exposition; setting details belong in narration.",
 "Overstates dialogue's role; it works alongside narration, not in place of it.",
 "Mistakes a device for a flaw; well-crafted dialogue clarifies character and moves the plot forward.",
 None],
"5002-049": [
 None,
 "Signals illustration, not causation; 'for example' introduces a supporting instance.",
 "Signals contrast, not cause; 'however' sets one idea against another.",
 "Signals comparison; 'similarly' links like ideas without making any causal claim."],
"5002-050": [
 "Confuses enjambment with stanza form; line runs have no effect on stanza size or symmetry.",
 None,
 "Attributes rhyme to enjambment; rhyme concerns end sounds, while enjambment concerns syntax crossing line breaks.",
 "Describes the opposite effect; enjambed lines carry meaning past the line break instead of stopping at it."],
"5002-051": [
 "Chooses a before-and-after learning tool; KWL charts track prior knowledge and questions, not character traits.",
 "Offers a puzzle with no analytic value; word searches build word recognition, not character comparison.",
 None,
 "Tracks plot rather than character; a timeline orders events without mapping traits or similarities."],
"5002-052": [
 "Confuses poetic structure with word meaning; rhyme scheme describes verse patterns.",
 "Pulls in the writer's life; denotation concerns the word itself, not its origin or author.",
 "Defines connotation; denotation is the neutral dictionary meaning, separate from feelings a word carries.",
 None],
"5002-053": [
 None,
 "Confuses literary craft with commerce; point of view has nothing to do with cost.",
 "Overstates the effect; genre is set by content and form, while point of view shapes perspective within a genre.",
 "Confuses narrative perspective with page design; typography is a layout choice, not a storytelling one."],
"5002-054": [
 "Increases load without teaching skill; longer passages give more chances to lose the thread, not tools to track it.",
 None,
 "Mistakes pace for support; reading faster typically widens cohesion gaps instead of closing them.",
 "Ignores the exact problem; without tracking transitions and referents, readers lose connections between sentences."],
"5002-055": [
 "Overstates the role; diagrams supplement prose, and key information usually appears in both.",
 "Dismisses function as ornament; diagrams carry information, such as labeled parts or processes.",
 None,
 "Treats a text feature as filler; publishers use diagrams to clarify content that words alone convey poorly."],
"5002-056": [
 "Confuses the thesis with a bibliography; sources belong in citations or references.",
 "Misassigns purpose; entertaining may flavor a thesis, but its job is to stake the essay's claim.",
 "Confuses content with structure; a thesis states an argument, not the essay's layout.",
 None],
"5002-057": [
 None,
 "Sees an active sentence; the subject 'teacher' performs the action, which is the active voice.",
 "Confuses present progressive with passive; no auxiliary-plus-past-participle structure appears here.",
 "Mistakes future tense for passive; the subject still performs the action actively."],
"5002-058": [
 "Gives a verdict without teaching; the student must still determine where transitions belong and which logic they signal.",
 None,
 "Splits craft from meaning; ignoring transitions leaves the essay's logical flow unaddressed.",
 "Removes the student from the revision; a teacher-rewritten essay models nothing the student can transfer."],
"5002-059": [
 "Fixes the passive but keeps vague wording; 'were good' remains imprecise and wordy next to 'yielded positive results.'",
 "Misses both problems; the passive construction is wordy and 'good' is too vague for formal research writing.",
 None,
 "Still buries the actor in a relative clause; 'that we did' adds words without removing the wordiness."],
"5002-060": [
 "Confuses completeness with complexity; a fragment lacks a subject or verb, while a compound sentence has two full clauses.",
 "Defines a simple sentence; one clause alone, however complete, is not compound.",
 "Defines a complex sentence; a dependent clause cannot stand alone and does not make a sentence compound.",
 None],
"5002-061": [
 None,
 "Mistakes imitation for understanding; copying models shows the product but hides the reasoning that produces it.",
 "Relies on a frame without thinking; fill-in-the-blanks produce sentences without teaching how to choose content.",
 "Assigns practice before instruction; a worksheet drills or assesses but does not demonstrate the drafting process."],
"5002-062": [
 "Mixes gerunds with bare verbs; 'swim' and 'bike' break the '-ing' series established by 'hiking.'",
 None,
 "Alternates gerunds with an infinitive; 'to swim' breaks the consistent '-ing' form of the series.",
 "Alternates infinitives with a gerund; 'swimming' interrupts the 'to + verb' pattern."],
"5002-063": [
 "Overgeneralizes from dependent clauses; many clauses are independent and fully able to stand alone as sentences.",
 "Judges by length; the distinction is grammatical, since a clause has a subject and verb regardless of word count.",
 None,
 "Collapses distinct units; a phrase lacks the subject-verb core that defines every clause."],
"5002-064": [
 "Reads as slangy and casual; exclamation-point closings suit friends, not a formal note to a teacher.",
 "Borrows affectionate letter slang; hugs-and-kisses closings are inappropriate for a teacher relationship.",
 "Uses playful slang; informal sign-offs undermine the respectful, professional tone a formal email requires.",
 None],
"5002-065": [
 None,
 "Does the intellectual work for the student; a teacher-written counterargument teaches nothing about addressing views.",
 "Replaces teaching with penalty; refusing credit offers no path toward strengthening the argument.",
 "Skips the teachable moment; without a counterargument, the persuasion stays one-sided and less credible."],
"5002-066": [
 "Confuses the semicolon's roles; commas separate simple list items, while semicolons join related independent clauses.",
 None,
 "Overstates interchangeability; a semicolon links two related clauses, while a period ends any sentence, related or not.",
 "Misplaces the mark; semicolons sit between clauses within a sentence and never open one."],
"5002-067": [
 "Picks an adverb; the '-ly' ending modifies verbs, adjectives, or other adverbs, not nouns.",
 "Chooses a verb; 'run' names an action rather than describing a noun.",
 None,
 "Trusts a noun-plus-suffix guess; 'happyful' is not a standard word, while 'beautiful' directly describes nouns."],
"5002-068": [
 None,
 "Repeats the name but stays indirect; a direct quotation resolves the ambiguity more cleanly than restating 'Tom.'",
 "Keeps the ambiguous 'he'; shifting to past perfect does not resolve who made the mistake.",
 "Dodges the pronoun with passive voice; the revision erases ambiguity by also erasing who made the mistake."],
"5002-069": [
 None,
 "Removes critique from review; praise-only feedback is pleasant but never tells writers what to improve.",
 "Mutes the exchange; silent reading may familiarize peers with drafts but produces no feedback at all.",
 "Reduces review to proofreading; circling errors targets conventions while ignoring content and organization."],
"5002-070": [
 "Defines concrete nouns; abstract nouns name intangibles like 'freedom' or 'courage.'",
 None,
 "Confuses abstractness with proper nouns; capitalization marks names and titles, not ideas.",
 "Overstates a pattern; many abstract nouns pluralize fine, as in 'opinions' or 'ideas.'"],
"5002-071": [
 "Reserves the exclamation point for strong emotion; declaratives state information and end with periods.",
 "Chooses a mid-sentence pause mark; commas separate elements and cannot end a sentence.",
 None,
 "Confuses sentence types; question marks end interrogatives, which ask rather than state."],
"5002-072": [
 "Uses indicative 'was' for a hypothetical; counterfactual conditionals take the subjunctive 'were.'",
 "Mixes tenses incoherently; present 'am' with past 'traveled' fits neither a real nor a hypothetical conditional.",
 "Overapplies the subjunctive; 'be' fits mandative constructions like 'suggest that he be,' not this conditional.",
 None],
}

def main():
    items = []
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            if o.get("test_code") == 5002:
                n = int(o["id"].split("-")[1])
                if 1 <= n <= 72:
                    items.append(o)
    items.sort(key=lambda o: int(o["id"].split("-")[1]))
    assert len(items) == 72, f"expected 72 items, got {len(items)}"

    problems = []
    count_exp = 0
    lines = []
    for o in items:
        iid = o["id"]
        exps = EXPL[iid]
        assert len(exps) == 4, f"{iid}: expl list length {len(exps)}"
        mapping = {}
        for ch, e in zip(o["choices"], exps):
            if ch == o["correct_answer"]:
                continue
            if e is None or not isinstance(e, str):
                problems.append(f"{iid}: missing explanation for choice {ch!r}")
                continue
            L = len(e)
            if not (60 <= L <= 200):
                problems.append(f"{iid}: length {L} out of range for {ch!r}: {e!r}")
            mapping[ch] = e
            count_exp += 1
        if len(mapping) != 3:
            problems.append(f"{iid}: got {len(mapping)} explanations, expected 3")
        if o["correct_answer"] in mapping:
            problems.append(f"{iid}: correct answer leaked as key")
        lines.append(json.dumps({"id": iid, "distractor_explanations": mapping},
                                ensure_ascii=False))

    if problems:
        print("SELF-CHECK FAILURES:")
        for p in problems:
            print(" -", p)
        raise SystemExit(1)

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    # final validation: re-read and re-verify keys against source
    with open(OUT, encoding="utf-8") as f:
        out = [json.loads(l) for l in f if l.strip()]
    src_map = {o["id"]: o for o in items}
    for r in out:
        o = src_map[r["id"]]
        keys = list(r["distractor_explanations"].keys())
        assert len(keys) == 3
        for k in keys:
            assert k in o["choices"], f"{r['id']}: key not verbatim: {k!r}"
            assert k != o["correct_answer"]
            assert 60 <= len(r["distractor_explanations"][k]) <= 200
    print(f"OK: wrote {len(out)} items, {count_exp} explanations -> {OUT}")

if __name__ == "__main__":
    main()
