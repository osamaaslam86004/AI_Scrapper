import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { url, userQuery } = await request.json();

    if (!url || !userQuery) {
      return NextResponse.json({ error: "Missing URL or userQuery" }, { status: 400 });
    }

    // 1. Ask Gemini to dynamically construct a JSON schema based on the query
    const schemaPrompt = `
      Analyze the user's data extraction request: "${userQuery}"
      Generate a standard JSON Schema (Draft 7) representing this data structure.
      The outer object must be a container holding an array of the extracted items.
      Return ONLY valid JSON. Do not include markdown code block formatting.
    `;

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: schemaPrompt,
      config: { responseMimeType: "application/json" }
    });

    const dynamicSchema = JSON.parse(aiResponse.text || '{}');

    // 2. Call your hosted Crawl4AI Render microservice to perform the crawl
    const crawl4aiEndpoint = `${process.env.CRAWL4AI_URL}/crawl`;
    
    const crawlResponse = await fetch(crawl4aiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.CRAWL4AI_API_TOKEN}` // Set in your Render config
      },
      body: JSON.stringify({
        url: url,
        extraction_strategy: {
          type: "llm",
          provider: "gemini/gemini-2.5-flash",
          api_token: process.env.GEMINI_API_KEY,
          schema: dynamicSchema,
          instruction: `Extract data exactly matching this user request: ${userQuery}`
        }
      })
    });

    const crawlResult = await crawlResponse.json();

    return NextResponse.json({
      success: true,
      schemaGenerated: dynamicSchema,
      data: JSON.parse(crawlResult.extracted_content)
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
