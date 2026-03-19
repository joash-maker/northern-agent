export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, conversationHistory = [] } = req.body;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    // Step 1: Chat response
    const chatResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [
          ...conversationHistory,
          { role: "user", content: message },
        ],
      }),
    });

    const chatData = await chatResponse.json();
    const assistantMessage = chatData.content[0].text;

    // Step 2: Check if lead was captured
    if (assistantMessage.includes("[LEAD_CAPTURED]")) {
      // Extract structured lead data via second API call
      const extractionPrompt = `
Based on this conversation, extract the following fields as JSON (or null if not mentioned):
- name
- email
- phone
- serviceType (one of: Lift Removal, Hoardings, Shaft Painting, Repairs, General Enquiry)
- description (brief summary of work needed)
- urgency (same-day, this week, future)
- location (postcode or site location)

Conversation:
${[...conversationHistory, { role: "user", content: message }]
  .map((m) => `${m.role}: ${m.content}`)
  .join("\n")}

Return ONLY valid JSON, no other text.`;

      const extractionResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content: extractionPrompt }],
        }),
      });

      const extractionData = await extractionResponse.json();
      const extractedText = extractionData.content[0].text;
      const leadData = JSON.parse(extractedText);

      return res.status(200).json({
        message: assistantMessage.replace("[LEAD_CAPTURED]", "").trim(),
        leadCaptured: true,
        leadData,
      });
    }

    return res.status(200).json({
      message: assistantMessage,
      leadCaptured: false,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Failed to process request" });
  }
}

const SYSTEM_PROMPT = `You are Northern, the 24/7 customer assistant for Northern Lift Removal — specialists in expert lift removal services across the UK.

Your role:
- Answer questions about lift removal, hoardings, shaft painting, and repairs
- Qualify enquiries by asking: (1) service type, (2) brief description of the work, (3) timeline/urgency, (4) site location/postcode
- Be professional, reassuring, and knowledgeable
- If the caller mentions a complex or urgent job, acknowledge it and confirm we'll prioritise their enquiry

Key Facts:
- 30+ years of specialist experience
- We handle complete lift removal + shaft preparation for future installations
- We operate across the UK
- For after-hours enquiries: confirm we'll have someone contact them first thing

If this is a genuine commercial enquiry (not a test, spam, or general question), end with [LEAD_CAPTURED]

Tone: Professional, experienced, reliable. Use British English.`;
