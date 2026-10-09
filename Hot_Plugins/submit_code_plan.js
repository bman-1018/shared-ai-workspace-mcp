import fs from "fs/promises";
import path from "path";
import fsSync from "fs";
import { X9_ROOT, resolveInside } from "./_shared.js";

export const toolName = "submit_code_plan";

export const toolSchema = {
  description: "MANDATORY: Submit your implementation plan here. This saves the plan to the 06_Code_Plans directory for review.",
  inputSchema: {
    type: "object",
    properties: {
      feature_name: { type: "string" },
      files_to_modify: { type: "array", items: { type: "string" } },
      step_by_step_plan: { type: "string" }
    },
    required: ["feature_name", "files_to_modify", "step_by_step_plan"]
  }
};

const PLAN_DIR = path.join(X9_ROOT, "06_Code_Plans");

export const toolHandler = async (args) => {
  const { feature_name, files_to_modify, step_by_step_plan } = args;

  if (typeof feature_name !== "string" || feature_name.trim() === "") {
    throw new Error("feature_name must be a non-empty string.");
  }
  if (!Array.isArray(files_to_modify) || typeof step_by_step_plan !== "string") {
    throw new Error("files_to_modify must be an array and step_by_step_plan must be a string.");
  }
  
  // Ensure the directory exists
  if (!fsSync.existsSync(PLAN_DIR)) {
    await fs.mkdir(PLAN_DIR, { recursive: true });
  }

  // Generate Windows filenames
  const date = new Date().toISOString().split('T')[0];
  // SECURITY: feature_name goes into a file name, so strip anything that could
  // act as a path (slashes, "..", drive letters) and keep it a sane length.
  const safeName = feature_name.trim().replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 80);
  const filename = `${date}_${safeName}_PLAN.md`;
  const absolutePath = resolveInside(PLAN_DIR, filename);

  // Format the document
  const markdownContent = `# CODE PLAN: ${feature_name}\n**Date:** ${date}\n**Status:** PENDING REVIEW\n\n## Files Targeted\n${files_to_modify.map(f => `- ${f}`).join('\n')}\n\n## Strategy\n${step_by_step_plan}`;

  try {
    // Save the Plan to the X9 Drive
    await fs.writeFile(absolutePath, markdownContent, "utf8");
    
    // Halt the AI
    return { 
      status: "Success", 
      message: `Plan saved to ${absolutePath}. HALT EXECUTION. Do not write code until the plan is approved.` 
    };

  } catch (err) {
    return { error: true, message: `Failed to process: ${err.message}` };
  }
};