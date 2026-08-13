// Content for /learn, extracted from the research team's
// "Deliverable 3 — Website Content Summary" (03-website-content-summary.md).
// Inline <cite> reference tags from the source markdown have been stripped —
// the underlying claims are kept verbatim. The internal "not for
// publication" appendix from that doc is intentionally not represented here.
//
// Supports light **bold** / *italic* inline markup, rendered by
// LearnPage.jsx's renderInline() — not a markdown pipeline, just two regexes.

export const PAGE_TITLE = "What Actually Makes a Prompt Work";
export const PAGE_SUBTITLE =
  "A plain-language guide to prompting, built from the official documentation of every major AI lab and the peer-reviewed research that tests it.";
export const LAST_REVIEWED_STAMP =
  "Last reviewed: August 2026 · Next scheduled review: November 2026";

export const SHORT_VERSION = {
  intro: "If you only read one paragraph:",
  paragraphs: [
    "**A good prompt is a complete specification, not a magic phrase.** The techniques that reliably improve results are the boring ones — saying what you want, who it's for, what format it should take, and what \"good\" looks like. The techniques that get shared most on social media — assigning the AI an expert persona, being especially polite, adding \"think step by step\" — turn out to be either inconsistent or, on modern models, largely redundant.",
    "That's not our opinion. It's what happens when researchers test the advice.",
  ],
};

export const PARTS = [
  {
    id: "what-works",
    number: 1,
    title: "Five things the research actually supports",
    sections: [
      {
        heading: "1. Specificity beats everything",
        paragraphs: [
          "Every vendor's documentation converges here, and it's the one recommendation no study has contradicted. Meta's own guidance puts it plainly: be clear and concise — your prompt should be easy to understand and provide enough information for the model to generate relevant output, avoiding jargon or technical terms that may confuse the model.",
          "The practical version: *\"Write a marketing email\"* gives the model nothing to work with. *\"Write a 150-word marketing email promoting a project-management app to freelance designers, casual and encouraging in tone, ending with one clear call-to-action\"* gives it five constraints it can actually satisfy.",
          "This is not a trick. It's just the difference between a brief and a wish.",
        ],
      },
      {
        heading: "2. Structure helps — but not for the reason people think",
        paragraphs: [
          "Separating your prompt into labelled sections — the task, the context, the constraints, the audience — makes a real difference. But the reason is more interesting than \"AI likes XML.\"",
          "A 2026 study ran 9,649 experiments across 11 models and 4 formats (YAML, Markdown, JSON, and a compact format called TOON), with schemas ranging from 10 to 10,000 items. The finding: format does not significantly affect aggregate accuracy (chi-squared = 2.45, p = 0.484), though individual models — particularly open-source ones — show format-specific sensitivities.",
          "So the brackets themselves aren't magic. What structure actually does is **force you to fill in the sections you'd otherwise leave blank.** You can't skip the audience field if there's an audience field staring at you. Structure is a completeness checklist wearing a syntax costume — and completeness is what moves the needle.",
          "There's a second, real benefit: labelled sections make it unambiguous which part of your message is *instruction* and which part is *data you're handing over*. That distinction matters a great deal when you're pasting in someone else's text.",
        ],
        builderNote: {
          section: "part1-structure",
          paragraphs: [
            "The same study found model capability is the dominant factor, with a 21-percentage-point accuracy gap between frontier and open-source tiers that dwarfs any format or architecture effect, and that file-based context retrieval improves accuracy for frontier-tier models (Claude, GPT, Gemini; +2.7%, p=0.029) but shows mixed results for open source models (aggregate −7.7%, p<0.001). Translation: don't spend your optimisation budget on format bikeshedding. Spend it on model selection and on information architecture — what goes in the window, in what order, and how the model navigates it.",
          ],
          source: "Source: McMillan (2026), arXiv:2602.05447.",
        },
      },
      {
        heading: "3. Examples are the strongest single lever",
        paragraphs: [
          "If you can show the model one or two examples of what you want, do it. This is called *few-shot prompting*, and it's the most consistently effective technique across every model family.",
          "Google's documentation demonstrates the mechanism directly — a prompt providing two examples that showed preference for shorter explanations guided the model to choose the shorter explanation, as opposed to the longer one it had picked previously, and notes that models can often pick up on patterns from a few examples, though you may need to experiment with the number.",
          "You don't need a perfect example. An imperfect one you edited into shape works fine — and is usually faster to produce than three paragraphs describing the shape you want.",
        ],
      },
      {
        heading: "4. Say what format you want, explicitly",
        paragraphs: [
          "This is the one that surprised researchers. In a Wharton study testing which prompt modifications actually change outcomes, prompt modifications like politeness influenced individual responses but had minimal overall effect, and aggregate model characteristics dominated over specific prompting strategies — while removing formatting instructions led to performance drops.",
          "Read that asymmetry carefully. *Politeness didn't matter. Removing the format instruction did.* If you're going to spend one sentence on prompt engineering, spend it on the output format, not on being nice.",
          "Google's guidance is the same: you can give instructions specifying the format of the response — a table, a bulleted list, an elevator pitch, keywords, a sentence, a paragraph.",
        ],
      },
      {
        heading: "5. Put your instructions in the right place — which depends on the model",
        paragraphs: [
          "Here's a rule almost nobody knows, straight from Google's Gemini documentation: when working with large datasets such as entire books, codebases, or long videos, place your specific instructions or questions at the end of the prompt, after the data context, and anchor the model's reasoning by starting your question with a phrase like \"Based on the preceding information…\".",
          "Meanwhile, most Claude and GPT guidance puts the task first. Both are correct — for their model. This is the clearest example of why \"one universal prompt\" is a myth, and why PromptMe generates model-specific variants rather than one output.",
        ],
      },
    ],
    conversionHook: {
      text: "PromptMe asks you these questions so you don't have to remember them.",
      linkText: "Try it →",
      fromSection: "part1",
    },
  },
  {
    id: "what-doesnt",
    number: 2,
    title: "Four things that don't work as advertised",
    intro:
      "This is the section other prompting guides won't write. We think it's the most useful part of the page.",
    sections: [
      {
        heading: "❌ \"Act as an expert\" doesn't make the AI smarter",
        paragraphs: [
          "The single most-repeated piece of prompting advice is to assign the model an expert persona. It has been tested, repeatedly, and it does not do what people think.",
          "A peer-reviewed study presented at EMNLP 2024 evaluated 162 roles covering 6 types of interpersonal relationships and 8 domains of expertise, across 4 popular LLM families and 2,410 factual questions, and found that adding personas in system prompts does not improve model performance. It also found that while aggregating results from the best persona for each question significantly improves accuracy, automatically identifying that best persona is challenging, with predictions often performing no better than random selection.",
          "A 2025 Wharton replication on much harder, PhD-level questions reached the same conclusion. As Ethan Mollick, one of its authors, put it: \"We found that telling the AI 'you are a great physicist' doesn't make it significantly more accurate at answering physics questions, nor does 'you are a lawyer' make it worse\" — adding that roles can be helpful for framing context and style, but they aren't magical, and sometimes giving the AI a role can actually lower accuracy.",
          "**So should you ever use a persona?** Yes — for *voice*. \"Write this the way a friendly veterinarian would explain it to a nervous pet owner\" is a genuinely useful instruction, because you're specifying tone and vocabulary. Just don't expect it to improve factual accuracy. Use personas to shape *how* it says something, not to make it *know* more.",
          "Notably, this advice still appears in vendor documentation. The Wharton team pointed this out directly: Google's Vertex AI prompt-design guide says to \"Assign a role\", Anthropic's samples include \"You are an expert AI tax analyst\", and OpenAI's developer materials take a similar approach — while independent research on performance gains from persona-based prompting is rare and inconsistent.",
        ],
      },
      {
        heading: "❌ \"Think step by step\" is mostly obsolete on modern models",
        paragraphs: [
          "Chain-of-thought prompting — telling the model to reason through a problem before answering — was a genuine breakthrough in 2022. In 2026, most frontier models do it automatically.",
          "Wharton tested it directly and found that its effectiveness varies significantly by model type and task: non-reasoning models show modest average improvements but increased variability in answers, while reasoning models gain only marginal benefits despite substantial time costs of 20–80%.",
          "Their bottom line: a simple chain-of-thought prompt is generally still useful for boosting average performance in non-reasoning models, especially older or smaller ones, but for dedicated reasoning models the added benefit appears negligible and may not justify the substantial increase in processing time.",
          "**Practical rule:** if you're using a reasoning model (Claude with extended thinking, GPT-5.x at medium or high reasoning effort, Gemini 3 Thinking, DeepSeek with thinking enabled), skip it — you're paying for tokens and latency to get something the model already does. If you're using a fast, cheap, non-reasoning model, it can still help.",
        ],
      },
      {
        heading: "❌ Politeness doesn't reliably help (or hurt)",
        paragraphs: [
          "Please and thank you are fine. They're just not a technique. The Wharton contingency study found being polite or commanding yields question-specific differences rather than global improvements, and these effects often diminish when aggregated. Be polite because you want to be, not because you think it's buying accuracy.",
        ],
      },
      {
        heading: "❌ There is no universal \"best prompt\"",
        paragraphs: [
          "The most-cited finding from the same study is the one nobody wants to hear: prompt variations produce inconsistent effects, challenging the notion of universally effective prompting techniques, and emphasising the necessity of context-specific evaluation.",
          "The same prompt can gain accuracy on one question and lose it on the next. Which means the honest advice isn't \"use this template\" — it's **\"try it, look at what came back, and adjust.\"** Iteration beats optimisation.",
          "xAI's own developer guidance makes this point about their fast models: instead of spending twenty minutes crafting the \"perfect\" prompt, fire off a quick attempt and refine based on the results — this iterative approach often gets you to a better outcome faster than trying to nail it in one shot.",
        ],
      },
    ],
  },
  {
    id: "by-model",
    number: 3,
    title: "Prompting each major model",
    intro: "Same principles, different dialects. Here's what each lab tells you that the others don't.",
    table: {
      headers: ["Model family", "The distinctive guidance", "What to change in your prompt"],
      rows: [
        [
          "Claude (Anthropic)",
          "Structured, tagged sections; explicit instruction to *act* rather than suggest",
          "Use labelled sections. If you want it to make the edit rather than propose one, say \"make these edits,\" not \"can you suggest changes\"",
        ],
        [
          "GPT-5.x (OpenAI)",
          "Reasoning effort is now a dial, and prompting differs by setting",
          "The `none` reasoning mode behaves much like GPT-4.1/4o, and prior guidance for non-reasoning models — few-shot examples, high-quality tool descriptions — applies there. GPT-5.2 remains prompt-sensitive and highly steerable in tone, verbosity, and output shape.",
        ],
        [
          "Gemini (Google)",
          "Terse by default; instructions go *after* long context",
          "Gemini 3 and 3.1 are less verbose and prefer direct answers — if you want a conversational tone, steer for it explicitly. Put your question last when the context is long.",
        ],
        [
          "Grok (xAI)",
          "Optimised for iteration speed over prompt perfection",
          "Draft fast, refine on the result",
        ],
        [
          "DeepSeek",
          "Task-specific temperature is published guidance",
          "0.0 for code and maths, 1.0 for data analysis, 1.3 for general conversation and translation, 1.5 for creative writing. Thinking mode is a request parameter, not a separate model.",
        ],
        [
          "Llama (Meta)",
          "Open-weight: chat template tokens are real",
          "Optimising prompts often provides the fastest path to better results — the performance improvements you need without additional model training or infrastructure costs. If you're calling a raw endpoint, the special tokens matter.",
        ],
        [
          "Mistral",
          "Organised by task capability",
          "Guidance is structured around four capabilities: classification, summarization, personalization, and evaluation. Frame your prompt as one of these.",
        ],
      ],
    },
    builderNote: {
      section: "part3",
      paragraphs: [
        "Treat these as *transform rules*, not trivia. A single canonical prompt object plus a per-model renderer is the correct architecture: same content, different assembly order, different scaffolding, different accompanying settings hints. That's exactly what PromptMe's model-specific copy feature does.",
        "Also worth knowing: OpenAI serves Markdown versions of its docs by appending `.md` to any page URL, and publishes a full index at `llms.txt`. Anthropic's docs live at `platform.claude.com/docs` (moved from `docs.anthropic.com`). Meta's moved from `llama.com/docs` to `developer.meta.com/ai/docs`.",
      ],
    },
    conversionHook: {
      text: "Copy your prompt formatted for Claude, ChatGPT, or Gemini.",
      linkText: "Build a prompt →",
      fromSection: "part3",
    },
  },
  {
    id: "checklist",
    number: 4,
    title: "A checklist you can actually use",
    intro: "Before you send a prompt, check whether you've said:",
    isChecklist: true,
    afterParagraphs: [
      "Anthropic's documentation frames that last item as a precondition for prompt engineering at all: the guide assumes you have a clear definition of the success criteria for your use case, some way to empirically test against those criteria, and a first draft prompt you want to improve.",
      "Most people skip it. It's the highest-leverage item on the list.",
      "**If a prompt isn't working**, Google's debugging checklist is the best published one: check for typos in the keywords that define the task, grammar that's difficult to parse or structurally awkward, punctuation that could cause misinterpretation, and domain-specific terms, acronyms or initialisms used without definition.",
    ],
  },
  {
    id: "context-engineering",
    number: 5,
    title: "Where the field is heading: context engineering",
    paragraphs: [
      "If you follow AI discussion, you'll see \"prompt engineering is dead, it's all context engineering now.\" That's overstated, but there's something real underneath it.",
      "The formal definition, from a 2025 survey: context engineering is a discipline that transcends simple prompt design to encompass the systematic optimisation of information payloads for LLMs — a superset relationship, where prompt engineering occurs within the context window while context engineering determines what fills that window.",
      "Andrej Karpathy's framing is the clearest: \"People associate prompts with short task descriptions… when in every industrial-strength LLM app, context engineering is the delicate art and science of filling the context window with just the right information for the next step.\"",
      "**What this means if you're a normal person using ChatGPT or Claude:** almost nothing changes. Your job is still to say clearly what you want and give the model what it needs to know. Attaching the right document *is* context engineering.",
      "**What it means if you're building something:** the prompt is one component of a larger system that also includes retrieval, memory, tool definitions, and conversation history. One useful framework proposes five quality criteria for that whole environment — relevance, sufficiency, isolation, economy, and provenance — which is a better rubric than any prompt-only checklist.",
      "Prompt engineering isn't dead. It got absorbed into something bigger, the way HTML didn't die when web frameworks arrived.",
    ],
  },
  {
    id: "resources",
    number: 6,
    title: "Learn more",
    linkGroups: [
      {
        heading: "Start here if you're new",
        links: [
          { label: "Learn Prompting — Introduction", url: "https://learnprompting.org/docs/introduction" },
          {
            label: "Google Workspace with Gemini Prompt Guide (PDF, organised by job role)",
            url: "https://workspace.google.com/learning/content/gemini-prompt-guide",
          },
        ],
      },
      {
        heading: "The reference guides",
        links: [
          { label: "Prompt Engineering Guide (DAIR.AI)", url: "https://www.promptingguide.ai/" },
          {
            label: "Anthropic — Prompt engineering overview",
            url: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview",
          },
          {
            label: "OpenAI — Prompt guidance",
            url: "https://developers.openai.com/api/docs/guides/latest-model",
          },
          {
            label: "Google — Prompt design strategies",
            url: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
          },
        ],
      },
      {
        heading: "The research",
        links: [
          { label: "The Prompt Report (58 techniques, catalogued)", url: "https://arxiv.org/abs/2406.06608" },
          {
            label: "↳ plain-language summary",
            url: "https://learnprompting.org/blog/the_prompt_report",
          },
          {
            label: "Wharton Prompting Science Reports (what actually holds up under testing)",
            url: "https://gail.wharton.upenn.edu/research-and-insights/",
          },
          {
            label: "When \"A Helpful Assistant\" Is Not Really Helpful (personas)",
            url: "https://aclanthology.org/2024.findings-emnlp.888/",
          },
          {
            label: "Structured Context Engineering for File-Native Agentic Systems (format vs. architecture)",
            url: "https://arxiv.org/abs/2602.05447",
          },
        ],
      },
      {
        heading: "To stay current",
        links: [
          { label: "Simon Willison's Weblog", url: "https://simonwillison.net/" },
          { label: "One Useful Thing, by Ethan Mollick", url: "https://www.oneusefulthing.org/" },
        ],
      },
    ],
  },
  {
    id: "sources",
    number: 7,
    title: "Our sources and how we check them",
    paragraphs: [
      "Everything on this page is drawn from one of three source types: **official documentation** published by the labs that build these models, **peer-reviewed research** (EMNLP, ICLR, ACL), or **preprints and technical reports** from named research groups.",
      "We flag when guidance is contested, and we tell you when a widely-repeated technique doesn't survive testing — including when the labs' own documentation still recommends it.",
      "We re-verify every link on this page quarterly. Vendor documentation moves often: Anthropic's docs relocated to a new domain, Meta's did too, and the Gemini prompting pages were updated twice in the last quarter alone. If you find a dead link, tell us.",
      "*Page last reviewed: 12 August 2026. Next scheduled review: November 2026.*",
    ],
  },
];

export const CHECKLIST_ITEMS = [
  {
    field: "task",
    label: "The task — what you want, as a verb. Not a topic, an instruction.",
  },
  {
    field: "audience",
    label:
      "The audience — who reads the output. This changes vocabulary, length and assumed knowledge more than anything else.",
  },
  {
    field: "format",
    label: "The format — length, structure, medium. (The one modification with measured effect.)",
  },
  {
    field: "context",
    label: "The context — background the model can't guess. Paste it in; don't summarise it.",
  },
  {
    field: "constraints",
    label: "The constraints — what to avoid, what to include, hard limits.",
  },
  {
    field: "example",
    label: "An example — of the output you want, or one you liked. Strongest single lever.",
  },
  {
    field: "success_criteria",
    label: "Success criteria — how you'll know it worked.",
  },
];
