// hello_forge.js
export const toolName = "hello_forge";

export const toolSchema = {
  name: "hello_forge",
  description: "A test tool to verify The Forge is compiling and hot-swapping correctly.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  },
  annotations: { title: "Forge self test", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
};

export const toolHandler = async (args) => {
  return { 
    status: "Success",
    message: "The Forge is online! This plugin was compiled dynamically from the X9 Drive." 
  };
};