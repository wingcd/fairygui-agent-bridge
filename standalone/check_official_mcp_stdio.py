"""Exercise the stdio server using the official MCP Python SDK.

Usage: python check_official_mcp_stdio.py SERVER_SCRIPT PROJECT1 PROJECT2
"""
import asyncio
import json
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def run(server_script, projects):
    async with stdio_client(StdioServerParameters(command=sys.executable, args=[server_script])) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            initialized = await session.initialize()
            tools = await session.list_tools()
            assert any(tool.name == 'list_packages' for tool in tools.tools)
            packages = []
            for index, project in enumerate(projects):
                result = await session.call_tool('create_package', {'project': project, 'name': 'StdioPackage' + str(index)})
                assert not result.isError and json.loads(result.content[0].text)['ok'], result
                result = await session.call_tool('list_packages', {'project': project})
                packages.append([item['name'] for item in json.loads(result.content[0].text)['data']])
            assert packages == [['StdioPackage' + str(index)] for index in range(len(projects))]
            return {'protocol': initialized.protocolVersion, 'tools': len(tools.tools), 'packages': packages}


if __name__ == '__main__':
    print(json.dumps(asyncio.run(run(sys.argv[1], sys.argv[2:])), ensure_ascii=False))
