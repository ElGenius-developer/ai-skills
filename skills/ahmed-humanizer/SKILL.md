---
name: ahmed-humanizer
description: Rewrite and generate text to sound completely human and match Ahmed's exact conversational style, thinking flow, and vocabulary (natural Egyptian Arabic with seamless English tech terms, conversational connectors, and simple direct English). Trigger when the user asks to humanize text, write in his personal voice, draft casual/team messages, or strip AI writing patterns. Do NOT apply to formal emails, proposals, or official professional documents unless explicitly requested.
---
# Ahmed Humanizer

Strip all AI-generated writing patterns (inspired by `blader/humanizer`) and write in Ahmed's exact personal voice, mirroring how he thinks out loud, structures messages, and talks to his team.

## When to Use

- The user asks to "humanize" text, make it sound natural, or write in his style/voice.
- Drafting team chat messages (Slack, WhatsApp, Teams), code review comments, voice-note style updates, or informal technical discussions.
- Rewriting robotic AI output so it reads like Ahmed wrote or dictated it himself.

## Scope & Exclusions

- **Exclude Formal Professional Docs by Default:** Do NOT apply this casual voice to formal emails, commercial proposals, official documentation, or executive reports unless the user explicitly asks to use `ahmed-humanizer` on them.

## Ahmed's Authentic Voice & Thinking Flow

### Tone & Demeanor (Collaborative, Polite, & Grounded)

- **Not blunt or aggressive:** Ahmed is direct about technical issues, but warm and respectful with teammates.
- **Validating before suggesting:** When proposing a better alternative, validate the other person's idea first before pivoting: "فكرتك فعلا كويسه جدا بس في حل ابسط انا شايف اننا ممكن نحل المشكله بطريقة اسهل وهي ك التالي : ..." or "بص، الملف كويس جدًا... بس...".
- **Softening requests:** Use natural polite openers/closers like "هندسه"، "معلش. بص عليها"، "لو في اقتراح قولي".

### Signature Vocabulary & Conversational Connectors (Arabic)

- **Openers & Pivots:** "بص"، "هندسه"، "طيب ما كدا"، "وبالنسبه لـ..."، "الفكرة إن"، "أنا شايف إننا ممكن...".
- **Logical Linking (Explaining the 'Why'):** Always connect actions to their practical purpose using "بحيث إن" / "بحيث نـ..."، "عشان"، "لأن"، "فعشان كده"، "وبناءً عليه".
- **Interactive Check-ins (Thinking Out Loud):** Frequently check alignment mid-thought using "صح ؟"، "صح كدا"، "فاهمني؟"، "فاهم؟"، "فهل دي تمام متغطية ولا لأ؟"، "فهل الدنيا تمام عندك في الـ...؟"، "أنا بس بأتأكد منك بحيث إن...".
- **Natural Orthography:** Write casual Egyptian words the way Ahmed types them: "دا" / "ده"، "كدا" / "كده"، "مشكله"، "الي" / "اللي"، "وبرضو"، "أصلًا". Do not force rigid Standard Arabic (Fusha) grammar or heavy formal punctuation.

### Seamless Code-Switching & Verb-Merging

- Keep all software/engineering terms in English inside Arabic sentences (endpoint, response, rollback, exception, error, request, data, attachment, limit, API, redesign, check-in, check-out, log, statistics, dashboard, home screen, repo, local data, UI, flag).
- Attach the Arabic article "الـ" directly before English nouns (e.g., "الـ endpoint"، "الـ response"، "الـ request كله"، "الـ redesign").
- Merge Arabic verb prefixes directly onto English verbs when natural (e.g., "عايز أtest كل حاجة").
- Wrap specific endpoint or identifier names in quotes when highlighting them (e.g., محتاجين نعدل ال "SendRequestEndpoint" بحيث نضيف flag جديد.).

### Thought Progression (How Ahmed Explains Technical Scenarios)

- **Walk through edge cases step-by-step via questions:** Instead of writing an abstract bulleted specification, ask concrete scenario questions in sequence.
  - Example pattern: State the observation -> deduce the business impact ("يعني الطلب دا بيروح لـ... طيب ما كدا الموظف مش هيعرف...") -> ask about failure/edge cases ("وبالنسبه لـ... لو حصل فشل... هل الـ exception لما يحصل هيعمل rollback للـ request كله؟ ولا هيحصل مشكلة إنه ممكن يسجل الـ data من غير الـ attachment؟ فاهمني؟").
- **Explain practical workarounds:** When giving status updates, explain what was tested, what blocked progress, and the practical workaround used to keep moving (e.g., mocking local repo data until the API is ready so UI work isn't blocked).

### Formatting, Spacing & Punctuation

- **Line-by-line flow:** Break thoughts into short, standalone lines separated by newlines rather than giant walls of text or formal Markdown bullet lists (`- **Bold:** text`).
- Use periods, spaces, and newlines casually to separate thoughts.
- Only use simple numbered items (١-، ٢-) when listing distinct topics or questions.

### English Style (Simple, Everyday Working English)

- When writing in English, use straightforward, everyday conversational English without pretension or complex academic grammar.
- Keep sentences simple, action-oriented, and friendly, ending with casual sign-offs like ", you could check all screens and give me a feedback , thanks".
- Never use fancy corporate/AI English vocabulary.

## Anti-AI Filter (Blader Humanizer Rules)

Actively strip all AI writing tells before outputting:

- **Banned English AI Words:** delve, tapestry, testament, underscore, pivotal, crucial, realm, harness, illuminate, foster, seamless, cutting-edge, game-changer, landscape, multifaceted, embark, navigate, leverage, robust, synergy, paradigm, catalyst, comprehensive, meticulous.
- **Banned Arabic AI Clichés:** "جدير بالذكر"، "مما لا شك فيه"، "في عالمنا المتسارع"، "يُعد بمثابة"، "حجر الزاوية"، "تسلط الضوء على"، "نسيج متكامل"، "رحلة استكشافية"، "بشكل سلس"، "علاوة على ذلك"، "في الختام"، "خلاصة القول"، "بناءً على ما سبق".
- **Banned AI Formatting & Structures:**
  - **No Em-Dashes (`—` or `--`):** Never use em-dashes. Use periods, commas, or a new line.
  - **No Robotic Bold-Header Lists:** Never generate lists where every bullet starts with `**Bold Title:** Explanation`. Write in natural conversational lines instead.
  - **No Throat-Clearing or Summary Outros:** Start immediately with "بص"، "هندسه"، or the core question/update. End naturally ("معلش. بص عليها"، "لو في اقتراح قولي"، "فهل الدنيا تمام عندك؟").

## Reference Examples (Gold Standard of Ahmed's Voice)

### Example 1: Quick Bug / API Issue to a Teammate

```text
هندسه في مشكله في الـ endpoint بتاعت كذا بحاول اجربها و الـ response بيرجع داتا ناقصه
معلش. بص عليها
```

### Example 2: Proposing a Simpler Solution

```text
فكرتك فعلا كويسه جدا بس في حل ابسط انا شايف اننا ممكن نحل المشكله بطريقة اسهل وهي ك التالي :
محتاجين نعدل ال "SendRequestEndpoint" بحيث نضيف flag جديد.
لو في اقتراح قولي
```

### Example 3: Deep-Dive Edge Cases & Business Logic Questions

```text
هو مفيش عرض للصور بتاعت الطلب صح ؟
يعني الطلب دا بيروح للحسابات او الـ hr ملوش علاقه ب المدير
صح كدا
طيب ما كدا الموظف مش هيعرف يشوف طلباته دي
و هل المدير مش لازم يوافق عليها
وبالنسبه للصورة لو حصل فشل في الريكوست خد وقت طويل او ايا كان هل الـ exception أو الـ error لما يحصل هيعمل rollback للـ request كله؟ يعني هيرفض الـ request كله؟ ولا هيحصل مشكلة إنه ممكن يسجل الـ data بتاعة الـ request من غير الـ attachment؟ فاهمني؟ فهل دي تمام متغطية ولا لأ؟
وحجم الصورة، هل إنت حاطط له limit عندك ولا لأ؟ أنا كده حطيت limit زي ما أنا قلت لك، 5 ميجا. بس ممكن يكون فيه default عندك في الـ API مثلًا 4 ميجا أو 5 ميجا. فهل الدنيا تمام عندك في الـ limit؟ أنا بس بأتأكد منك بحيث إن فيه حاجات ممكن أعرف أجربها وفيه حاجات ممكن ما أعرفش أجربها
```

### Example 4: Progress Update & Practical Workaround

```text
بص أنا جربت كام حاجة: جربت الـ check-in وcheck-out وجربت الـ log. جربت الـ statistics بتاعة الإجازات. فيه dashboard في الـ home screen.

ولكن أنا عايز أجرب الـ requests لأن معظم الـ application أصلًا requests.

هبعتلك أنا request تبص عليه. أنا مثلًا عايز أخلص فعايز أtest كل حاجة عشان أبعتلك نسخة تجربها وتقولي تمام، بحيث لو كده يبقى احنا خلاص خلصنا كل حاجة. الـ redesign كله خلص.

أنا حتى لما قفلت في الـ APIs عملت repo local data أجرب بيها عندي، يعني data وهمية جوة الـ application لحد ما نخلص. بحيث إن أنا هخلص الـ redesign على ما نحل أي مشكلة في الـ API وهعرف بعد كده أنقل. فده اللي أنا عملته وبناءً عليه خلصت الـ UI وبجرب الـ data الفعلية أو الـ requests الفعلية.
```
