import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Lightweight logger to print concise diagnostics to the Next.js server console
function log(tag: string, ...args: any[]) {
  try {
    console.log(`[scrape:${tag}]`, ...args);
  } catch (e) {
    // ignore
  }
}

export async function POST(request: Request) {
  try {
    const { url, userQuery } = await request.json();

    if (!url || !userQuery) {
      return NextResponse.json({ error: "Missing URL or userQuery" }, { status: 400 });
    }

    // 0. Validate required environment variables
    log('start', { url, userQuery });

    if (!process.env.GEMINI_API_KEY) {
      log('error', 'Missing GEMINI_API_KEY');
      return NextResponse.json({ error: 'Missing GEMINI_API_KEY. Set GEMINI_API_KEY in your environment.' }, { status: 500 });
    }

    if (!process.env.CRAWL4AI_URL) {
      log('error', 'Missing CRAWL4AI_URL');
      return NextResponse.json({ error: 'Missing CRAWL4AI_URL. Set CRAWL4AI_URL in your environment (e.g. http://127.0.0.1:8000).' }, { status: 500 });
    }

    // Initialize the Google client here so the library won't try to load default ADC when the key is not present
    log('env', { CRAWL4AI_URL: process.env.CRAWL4AI_URL?.replace(/:\/\/.*@/, '://[REDACTED@]') });

    // Mock mode: skip calling external AI and crawl services and return a predictable sample
    const mockMode = (process.env.MOCK_AI === '1' || process.env.MOCK_AI === 'true' || process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true');
    if (mockMode) {
      log('mock', { enabled: true });
      const dynamicSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                link: { type: 'string' }
              },
              required: ['title', 'link']
            }
          }
        }
      } as any;

      const sampleData = [
        { title: 'Top Article 1', link: 'https://example.com/1' },
        { title: 'Top Article 2', link: 'https://example.com/2' },
        { title: 'Top Article 3', link: 'https://example.com/3' }
      ];

      return NextResponse.json({ success: true, schemaGenerated: dynamicSchema, data: sampleData });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // 1. Ask Gemini to dynamically construct a JSON schema based on the query
    const schemaPrompt = `
      Analyze the user's data extraction request: "${userQuery}"
      Generate a standard JSON Schema (Draft 7) representing this data structure.
      The outer object must be a container holding an array of the extracted items.
      Return ONLY valid JSON. Do not include markdown code block formatting.
    `;

    let aiResponse: any;
    try {
      aiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: schemaPrompt,
        config: { responseMimeType: "application/json" }
      });
      log('aiResponseStatus', { length: aiResponse?.text?.length || 0 });
      log('aiResponseSnippet', (aiResponse?.text || '').slice(0, 800));
    } catch (e: any) {
      log('aiError', e?.message || e);
      return NextResponse.json({ success: false, error: `AI generation failed: ${e?.message || String(e)}` }, { status: 502 });
    }

    const dynamicSchema = (() => {
      try {
        return JSON.parse(aiResponse.text || '{}');
      } catch (e) {
        log('aiParseError', e);
        return {};
      }
    })();

    // 2. Call your hosted Crawl4AI Render microservice to perform the crawl
    const crawl4aiEndpoint = `${process.env.CRAWL4AI_URL.replace(/\/$/, '')}/api/scrape`;
    log('crawlEndpoint', crawl4aiEndpoint);

    const crawlResponse = await fetch(crawl4aiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.CRAWL4AI_API_TOKEN}` // Set in your Render config
      },
      body: JSON.stringify({
        url: url,
        user_query: userQuery,
        extraction_strategy: {
          type: "llm",
          provider: "gemini/gemini-2.5-flash",
          api_token: process.env.GEMINI_API_KEY,
          schema: dynamicSchema,
          instruction: `Extract data exactly matching this user request: ${userQuery}`
        }
      })
    });
    log('crawlRequestSent');

    if (!crawlResponse.ok) {
      const text = await crawlResponse.text();
      log('crawlError', { status: crawlResponse.status, body: text });
      return NextResponse.json({ success: false, error: `Crawl service returned ${crawlResponse.status}: ${text}` }, { status: 502 });
    }

    const crawlResultText = await crawlResponse.text();
    log('crawlResponseText', crawlResultText.slice(0, 2000));

    let crawlResult: any;
    try {
      crawlResult = JSON.parse(crawlResultText);
    } catch (e) {
      log('crawlParseError', e);
      return NextResponse.json({ success: false, error: 'Invalid JSON returned from crawl service' }, { status: 502 });
    }

// ✅ WITH THIS CORRECTED BLOCK:
    let extracted = null;
    try {
      // 1. Get the raw array from crawlResult.data
      const rawData = crawlResult.data; 
      
      if (Array.isArray(rawData) && rawData.length > 0) {
        // 2. If the schema wrapped the array inside an object key (like "articles")
        const firstEntry = rawData[0];
        const possibleArrayKey = Object.keys(firstEntry).find(key => Array.isArray(firstEntry[key]));
        
        if (possibleArrayKey) {
          extracted = firstEntry[possibleArrayKey]; // Extracts the inner [articles] array!
        } else {
          extracted = rawData;
        }
      } else {
        extracted = rawData || [];
      }
    } catch (e) {
      log('extractedParseError', e);
      return NextResponse.json({ success: false, error: 'Failed to process extracted data structure' }, { status: 502 });
    }

    log('success', { items: Array.isArray(extracted) ? extracted.length : 0 });

    return NextResponse.json({
      success: true,
      schemaGenerated: dynamicSchema,
      data: extracted
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
