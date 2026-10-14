"""Read the latest real sample through MCP and save an explicitly labeled test analysis."""
import asyncio
from pathlib import Path
import sys
from mcp import Client, StdioServerParameters

async def main():
    server=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).resolve().parents[1]/'service/call_mcp.py')])
    async with Client(server) as client:
        tools=await client.list_tools()
        print('Tools:', ', '.join(t.name for t in tools.tools))
        calls=await client.call_tool('list_calls',{'query':'Sample · Project briefing','limit':1})
        if calls.is_error:raise RuntimeError(calls)
        # The SDK returns structured lists under result for list-valued tools.
        data=calls.structured_content
        if isinstance(data,dict):data=data.get('result',data.get('items',data))
        if not isinstance(data,list):
            import json
            data=json.loads(calls.content[0].text)
            if isinstance(data,dict):data=data.get('result',data)
        if not data:raise RuntimeError('Run the sample call first.')
        call_id=data[0]['id']
        result=await client.call_tool('get_call',{'call_id':call_id})
        if result.is_error:raise RuntimeError(result)
        print('Read sample transcript:',call_id)
        saved=await client.call_tool('save_call_analysis',{'call_id':call_id,'author':'MCP connection test','markdown':'MCP connection verified. The assistant can search this library, read the saved transcript, and append an analysis without changing the original. This is a connectivity test, not an AI-generated meeting summary.'})
        if saved.is_error:raise RuntimeError(saved)
        print('Saved versioned test analysis successfully.')

if __name__=='__main__':asyncio.run(main())
