// supabase/functions/generate-answer/index.ts
//
// LLM proxy Edge Function for Applicant Copilot.
// Accepts a question + context, calls Gemini Flash (free tier), logs usage, returns answer.
// Model-agnostic design — swap to Claude or other providers by changing the provider config.
//
// Deno runtime — uses Deno.serve(), Web Fetch API, and Supabase client.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Types ---

interface RequestBody {
  question: string;
  jd_text?: string;
  jd_company?: string;
  jd_role?: string;
  user_profile?: {
    full_name?: string;
    headline?: string;
    summary?: string;
    target_roles?: string[];
    experiences?: Array<{
      company: string;
      title: string;
      description?: string;
      impact?: string;
      skills?: string[];
    }>;
  };
  application_id?: string;
  max_tokens?: number;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion: string;
}

// --- Constants ---

const GEMINI_MODEL = "gemini-2.0-flash";
const MAX_TOKENS_DEFAULT = 1024;

// Gemini Flash is free tier — $0 cost. Log tokens for future billing when we upgrade.
const COST_PER_INPUT_TOKEN = 0;
const COST_PER_OUTPUT_TOKEN = 0;

// Rate limit: tracked per user via usage_logs count in the last hour
const MAX_REQUESTS_PER_HOUR = 50;

// --- CORS headers ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Helper: Build system prompt ---

function buildSystemPrompt(
  profile: RequestBody["user_profile"],
  jdCompany?: string,
  jdRole?: string,
  jdText?: string,
): string {
  let prompt =
    `You are an expert career coach and application assistant for a job applicant. Your role is to help craft authentic, tailored answers to job application questions.

IMPORTANT GUIDELINES:
- Write in first person as if you ARE the applicant
- Reference specific experiences and achievements from the applicant's profile
- Tailor the answer to the specific job and company
- Be professional but authentic — avoid generic corporate speak
- Keep answers concise (100-200 words) unless the question clearly requires more
- Never fabricate experiences or skills not in the profile
- If the profile lacks relevant experience for the question, acknowledge it honestly and pivot to transferable skills
- Respond with ONLY the answer text. No preamble, no "Here's a draft", no quotes around the answer.`;

  if (profile) {
    prompt += `\n\n--- APPLICANT PROFILE ---`;
    if (profile.full_name) prompt += `\nName: ${profile.full_name}`;
    if (profile.headline) prompt += `\nHeadline: ${profile.headline}`;
    if (profile.summary) prompt += `\nSummary: ${profile.summary}`;
    if (profile.target_roles?.length) {
      prompt += `\nTarget Roles: ${profile.target_roles.join(", ")}`;
    }
    if (profile.experiences?.length) {
      prompt += `\n\nWORK EXPERIENCE:`;
      for (const exp of profile.experiences) {
        prompt += `\n- ${exp.title} at ${exp.company}`;
        if (exp.description) prompt += `\n  ${exp.description}`;
        if (exp.impact) prompt += `\n  Impact: ${exp.impact}`;
        if (exp.skills?.length) {
          prompt += `\n  Skills: ${exp.skills.join(", ")}`;
        }
      }
    }
  }

  if (jdCompany || jdRole || jdText) {
    prompt += `\n\n--- TARGET JOB ---`;
    if (jdCompany) prompt += `\nCompany: ${jdCompany}`;
    if (jdRole) prompt += `\nRole: ${jdRole}`;
    if (jdText) prompt += `\nJob Description:\n${jdText}`;
  }

  return prompt;
}

// --- Helper: Calculate cost ---

function calculateCost(
  inputTokens: number,
  outputTokens: number,
): { cost_usd: number; billed_usd: number } {
  const cost_usd = inputTokens * COST_PER_INPUT_TOKEN +
    outputTokens * COST_PER_OUTPUT_TOKEN;
  // When we move to paid models, apply margin here
  const billed_usd = cost_usd;
  return {
    cost_usd: Math.round(cost_usd * 1_000_000) / 1_000_000,
    billed_usd: Math.round(billed_usd * 1_000_000) / 1_000_000,
  };
}

// --- Service client (initialized once per cold start) ---

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const serviceClient = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// --- Main handler ---

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // -- Env check --
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !serviceClient) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -- Auth: extract user from JWT --
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: authError?.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -- Rate limit check --
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentRequests, error: countError } = await serviceClient
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_at", oneHourAgo);

    if (countError) {
      console.error("Rate limit check failed:", countError);
      // Fail open — don't block on rate limit check failure
    } else if (
      recentRequests !== null && recentRequests >= MAX_REQUESTS_PER_HOUR
    ) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          detail:
            `Maximum ${MAX_REQUESTS_PER_HOUR} requests per hour. Try again later.`,
          retry_after_seconds: 3600,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -- Parse request body --
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (
      !body.question || typeof body.question !== "string" ||
      body.question.trim().length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "Missing required field: question" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const maxTokens = Math.min(
      body.max_tokens || MAX_TOKENS_DEFAULT,
      4096,
    );

    // -- Build prompt and call Gemini --
    const systemPrompt = buildSystemPrompt(
      body.user_profile,
      body.jd_company,
      body.jd_role,
      body.jd_text,
    );

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: body.question }],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.3,
          responseMimeType: "text/plain",
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error(
        `Gemini API error: ${geminiResponse.status}`,
        errorBody,
      );

      if (geminiResponse.status === 429) {
        return new Response(
          JSON.stringify({
            error: "AI provider rate limited. Try again in a moment.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ error: "AI generation failed. Please try again." }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const result: GeminiResponse = await geminiResponse.json();

    // Handle empty/blocked responses (e.g., safety filter)
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      return new Response(
        JSON.stringify({
          error:
            "AI could not generate an answer. Try rephrasing the question.",
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const answerText = candidate.content.parts[0].text;
    const inputTokens = result.usageMetadata?.promptTokenCount || 0;
    const outputTokens = result.usageMetadata?.candidatesTokenCount || 0;

    // -- Log usage --
    const { cost_usd, billed_usd } = calculateCost(inputTokens, outputTokens);

    const { error: logError } = await serviceClient.from("usage_logs").insert({
      profile_id: user.id,
      tokens_input: inputTokens,
      tokens_output: outputTokens,
      model: result.modelVersion || GEMINI_MODEL,
      cost_usd,
      billed_usd,
      action_type: "answer_generation",
      metadata: {
        question_preview: body.question.substring(0, 100),
        application_id: body.application_id || null,
      },
    });

    if (logError) {
      console.error("CRITICAL: Usage log insert failed:", logError);
    }

    // -- Return response --
    return new Response(
      JSON.stringify({
        answer: answerText,
        model: result.modelVersion || GEMINI_MODEL,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd,
          billed_usd,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Unhandled error in generate-answer:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
