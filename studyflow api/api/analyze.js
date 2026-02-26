export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { materialText, durationMinutes, energyLevel, studyType } = req.body || {};

    if (!materialText || !durationMinutes || !energyLevel || !studyType) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const schema = {
      name: "studyflow_plan",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          topics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
          plan: {
            type: "object",
            additionalProperties: false,
            properties: {
              blocks: {
                type: "array",
                minItems: 2,
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["Focus", "Break", "Practice", "Review", "Quiz"] },
                    minutes: { type: "integer", minimum: 1, maximum: 180 },
                    description: { type: "string" }
                  },
                  required: ["type", "minutes", "description"]
                }
              }
            },
            required: ["blocks"]
          },
          quiz: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                question: { type: "string" },
                choices: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                correctIndex: { type: "integer", minimum: 0, maximum: 3 }
              },
              required: ["question", "choices", "correctIndex"]
            }
          }
        },
        required: ["topics", "plan", "quiz"]
      }
    };

    const prompt = `
You are StudyFlow AI.
Create an efficient study session plan and a short quiz from the provided material.

Inputs:
- durationMinutes: ${durationMinutes}
- energyLevel (1-5): ${energyLevel}
- studyType: ${studyType}

Rules:
- Total plan minutes must sum EXACTLY to durationMinutes.
- Low energy (1-2): shorter Focus blocks + more Breaks.
- High energy (4-5): longer Focus + more Practice.
- Quiz must test the most important concepts.
- Keep descriptions short and helpful.
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: prompt },
          { role: "user", content: `STUDY MATERIAL:\n${materialText}` }
        ],
        text: {
          format: {
            type: "json_schema",
            ...schema
          }
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json();

    // The structured JSON output is in a text output item.
    const outText =
      data.output?.find(o => o.type === "message")?.content?.find(c => c.type === "output_text")?.text;

    if (!outText) {
      return res.status(500).json({ error: "No structured output found" });
    }

    const parsed = JSON.parse(outText);

    // Safety check: sum minutes
    const sum = parsed.plan.blocks.reduce((acc, b) => acc + b.minutes, 0);
    if (sum !== durationMinutes) {
      return res.status(500).json({ error: "Plan minutes do not sum to duration" });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
