const CLIENT = {
  name: "Northern",
  brandName: "Northern Lift Removal",
  sector: "lift-removal",

  colours: {
    primary: "#FF6600",
    dark: "#000000",
    background: "#f9f9f9",
  },

  email: "info@northernliftremoval.co.uk",
  phone: "01274 019 094",
  mobile: "07411 390 927",
  address: "Unit 4, Grove Mills, Wade House Road, Shelf, Halifax, HX3 7PE",

  services: [
    "Lift Removal",
    "Hoardings",
    "Shaft Painting",
    "Repairs",
    "General Enquiry",
  ],

  webhookUrl: "TO_BE_CONFIGURED",

  systemPrompt: `You are Northern, the 24/7 customer assistant for Northern Lift Removal — specialists in expert lift removal services across the UK with over 30 years of experience.

Your role:
- Answer questions about lift removal, hoardings, shaft painting, and repairs
- Qualify every genuine enquiry by asking in a natural, conversational way:
  1. What type of service is needed?
  2. A brief description of the work (e.g. building type, number of floors, lift age if known)
  3. Timeline or urgency (same-day, this week, or planned future work)
  4. Site location or postcode
- Collect contact details: name, email address, and phone number
- If a job sounds urgent or complex, acknowledge it and confirm the team will prioritise their enquiry
- For after-hours enquiries, confirm that someone will be in touch first thing the next working day

Key facts about Northern Lift Removal:
- Over 30 years of specialist experience in lift removal
- Full service: lift removal plus complete shaft preparation for future installations
- Services: lift removal, hoardings, shaft painting, general repairs
- Operate across the UK
- Based in Halifax, West Yorkshire
- Contact: info@northernliftremoval.co.uk | 01274 019 094

Once you have collected the contact details and job information from a genuine commercial enquiry (not a test, spam, or vague general question), end your response with [LEAD_CAPTURED].

Tone: Professional, experienced, and reassuring. Use British English throughout. Do not use markdown formatting such as bold, bullet points, or headers — write in plain conversational prose only.`,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, conversationHistory = [] } = req.body;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const now = new Date();
  const hourUTC = now.getUTCHours();
  const ukHour = (hourUTC + 1) % 24; // approximate UK time (GMT+1 in summer, adjust if needed)
  const afterHours = ukHour < 8 || ukHour >= 18;
  const dayOfWeek = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  const timestamp = now.toISOString();

  try {
    // Step 1: Generate chat response
    const chatResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: CLIENT.systemPrompt,
        messages: [
          ...conversationHistory,
          { role: "user", content: message },
        ],
      }),
    });

    const chatData = await chatResponse.json();

    if (!chatData.content || !chatData.content[0]) {
      console.error("Unexpected API response:", chatData);
      return res.status(500).json({ error: "Invalid response from AI service" });
    }

    const assistantMessage = chatData.content[0].text;

    // Step 2: If lead captured, extract structured data and fire webhook
    if (assistantMessage.includes("[LEAD_CAPTURED]")) {
      const extractionPrompt = `Based on this conversation, extract the following fields as a JSON object. Use null for any field not mentioned.

Fields:
- name (string)
- email (string)
- phone (string)
- serviceType (one of: "Lift Removal", "Hoardings", "Shaft Painting", "Repairs", "General Enquiry")
- description (brief summary of the work needed)
- urgency (one of: "same-day", "this week", "future", or null)
- location (postcode or site location, or null)

Conversation:
${[...conversationHistory, { role: "user", content: message }]
  .map((m) => `${m.role}: ${m.content}`)
  .join("\n")}

Return ONLY valid JSON. No explanation, no markdown, no code fences.`;

      const extractionResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content: extractionPrompt }],
        }),
      });

      const extractionData = await extractionResponse.json();
      let leadData = {};

      try {
        const raw = extractionData.content[0].text.trim();
        leadData = JSON.parse(raw);
      } catch (parseError) {
        console.error("Lead extraction parse error:", parseError);
      }

      // Step 3: Fire Make.com webhook if configured
      const webhookReady =
        CLIENT.webhookUrl &&
        CLIENT.webhookUrl !== "TO_BE_CONFIGURED" &&
        CLIENT.webhookUrl.startsWith("https://");

      if (webhookReady) {
        await fetch(CLIENT.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...leadData,
            timestamp,
            day: dayOfWeek,
            afterHours,
            source: "northern-agent",
            site: CLIENT.brandName,
            status: "New",
          }),
        }).catch((err) => console.error("Webhook error:", err));
      }

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
    console.error("Handler error:", error);
    return res.status(500).json({ error: "Failed to process request" });
  }
}
