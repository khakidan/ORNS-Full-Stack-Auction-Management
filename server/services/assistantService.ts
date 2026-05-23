import { genAI } from "./genai";

export async function handleAssistantRequest(context: string, message: string, history: any[]): Promise<string> {
  const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
      
  const mappedContext = recentHistory.map((msg: any) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  mappedContext.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const result = await genAI.models.generateContent({
    model: modelName,
    contents: mappedContext,
    config: {
      systemInstruction: context || "You are an AI assistant for a charity auction.",
    }
  });

  const finishReason = result.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error("AI generation interrupted");
  }

  return result.text || "";
}
