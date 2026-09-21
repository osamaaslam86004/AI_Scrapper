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

    // Robust JSON extraction: AI responses sometimes include extra text
    function extractJSONFromText(text: string) {
      if (!text) return {};

      // 1) Direct parse
      try {
        return JSON.parse(text);
      } catch (e) {
        // continue to fallback strategies
      }

      // 2) Look for fenced code block with JSON
      try {
        const codeBlockMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
          return JSON.parse(codeBlockMatch[1]);
        }
      } catch (e) {
        // ignore and continue
      }

      // 3) Find first JSON-like substring by matching braces/brackets and counting depth
      const firstObjIdx = (() => {
        const idxs = ['{', '[']
          .map((ch) => ({ ch, idx: text.indexOf(ch) }))
          .filter(x => x.idx >= 0)
          .sort((a, b) => a.idx - b.idx);
        return idxs.length ? idxs[0] : null;
      })();

      if (firstObjIdx) {
        const open = firstObjIdx.ch;
        const close = open === '{' ? '}' : ']';
        let depth = 0;
        for (let i = firstObjIdx.idx; i < text.length; i++) {
          const ch = text[i];
          if (ch === open) depth++;
          else if (ch === close) depth--;
          if (depth === 0) {
            const candidate = text.slice(firstObjIdx.idx, i + 1);
            try {
              return JSON.parse(candidate);
            } catch (e) {
              break; // cannot parse, fall through
            }
          }
        }
      }

      // 4) Give up: return empty object
      return {};
    }

    const dynamicSchema = (() => {
      try {
        return extractJSONFromText(aiResponse.text || '{}');
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

    // 1. Grab raw data from crawlResult.data
    let extracted = crawlResult.data || null;

    // Normalize extracted payloads: coerce string responses into object shapes
    function normalizeExtracted(payload: any) {
      if (payload == null) return payload;
      if (Array.isArray(payload)) {
        return payload.map(item => {
          if (typeof item === 'string') {
            // Try to parse JSON string first
            try {
              const parsed = JSON.parse(item);
              if (parsed && typeof parsed === 'object') return parsed;
            } catch (e) {
              // not JSON
            }
            // Fallback: wrap plain string into an object for downstream processing
            return { text: item };
          }
          if (typeof item === 'object' && item !== null) return item;
          return { value: item };
        });
      }

      if (typeof payload === 'string') {
        try {
          const parsed = JSON.parse(payload);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {
          // not JSON
        }
        return { text: payload };
      }

      return payload;
    }

    // Look for errors in the extracted payload
    if (Array.isArray(extracted) && extracted.length > 0) {
      const firstObj = extracted[0];

      if (firstObj?.error) {
        // Extract detailed error information if available
        const detailMsg = firstObj.content || firstObj.message || firstObj.raw_response || firstObj.details || JSON.stringify(firstObj);

        // Try to parse `content` if it contains JSON to provide richer diagnostics
        let parsedContent: any = null;
        try {
          if (typeof firstObj.content === 'string' && (firstObj.content.trim().startsWith('{') || firstObj.content.trim().startsWith('['))) {
            parsedContent = JSON.parse(firstObj.content);
          }
        } catch (e) {
          parsedContent = null;
        }

        return NextResponse.json({ 
          success: false, 
          error: `Crawl4AI LLM Extraction Error: ${detailMsg}`,
          detail: detailMsg,
          parsedContent,
          errors: extracted,
          firstError: firstObj
        }, { status: 500 });
      }

      // Flatten nested schema wrappers (e.g., { "articles": [...] })
      const arrayKey = Object.keys(firstObj).find(k => Array.isArray(firstObj[k]));
      if (arrayKey) {
        extracted = firstObj[arrayKey];
      }
    }

    const normalizedData = normalizeExtracted(extracted);

    return NextResponse.json({
      success: true,
      schemaGenerated: dynamicSchema,
      data: normalizedData
    });
  } catch (error: any) {
    log('unexpectedError', error?.message || error);
    return NextResponse.json({ success: false, error: `Unexpected error: ${error?.message || String(error)}` }, { status: 500 });
  }
}