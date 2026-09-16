"""Example custom agent tool.

To register this tool, add it to your palette-plugin.json:
{
  "tools": [{
    "name": "example_tool",
    "description": "An example custom tool",
    "entry": "./backend/tools/example_tool.py"
  }]
}

Then assign the tool name to an agent's tools list in the agents section:
{
  "agents": [{
    "name": "My Agent",
    "tools": ["example_tool"]
  }]
}
"""

from palette_sdk import ToolDefinition


class ExampleTool(ToolDefinition):
    name = "example_tool"
    description = "An example tool that echoes input back. Replace this with your own logic."
    input_schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The input query to process",
            },
        },
        "required": ["query"],
    }

    async def run(self, input_data: dict, context: dict) -> str:
        query = input_data.get("query", "")
        return f"ExampleTool received: {query}"


# The plugin loader looks for a `tool` attribute or any ToolDefinition subclass
tool = ExampleTool
