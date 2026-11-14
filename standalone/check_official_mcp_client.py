"""Exercise the HTTP endpoint using the official MCP Python SDK.

Requires the `mcp` package in the Python environment used to run this file.
Usage: python check_official_mcp_client.py URL PROJECT1 PROJECT2
"""
import asyncio
import json
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def run(url, projects):
    async with streamable_http_client(url) as (reader, writer, get_session_id):
        async with ClientSession(reader, writer) as session:
            initialized = await session.initialize()
            tools = await session.list_tools()
            assert any(tool.name == 'create_package' for tool in tools.tools)
            async def build(index):
                args = {'project': projects[index], 'name': 'SdkPackage' + str(index)}
                result = await session.call_tool('create_package', args)
                assert not result.isError, result
                assert json.loads(result.content[0].text)['ok']
                result = await session.call_tool('list_packages', {'project': projects[index]})
                assert not result.isError, result
                return [item['name'] for item in json.loads(result.content[0].text)['data']]
            packages = await asyncio.gather(*(build(index) for index in range(len(projects))))
            assert packages == [['SdkPackage' + str(index)] for index in range(len(projects))]
            return {'protocol': initialized.protocolVersion, 'tools': len(tools.tools), 'packages': packages, 'session': get_session_id()}


if __name__ == '__main__':
    print(json.dumps(asyncio.run(run(sys.argv[1], sys.argv[2:])), ensure_ascii=False))
