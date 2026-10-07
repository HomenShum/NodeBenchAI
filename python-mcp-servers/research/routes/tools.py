"""
Tool execution endpoints
"""
import time
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from services.research_tools import get_research_tools

router = APIRouter()


class ToolRequest(BaseModel):
    """Tool execution request"""
    tool_name: str
    parameters: Dict[str, Any] = {}
    secret: Optional[str] = None


class ToolResponse(BaseModel):
    """Tool execution response"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    tool_name: str
    execution_time_ms: float


@router.get("/list")
async def list_tools():
    """
    List all available research tools
    """
    tools = get_research_tools()
    return {
        "success": True,
        "tools": tools.list_tools(),
        "count": len(tools.list_tools()),
    }


@router.post("/execute")
async def execute_tool(request: ToolRequest, response: Response) -> ToolResponse:
    """
    Execute a research tool
    """
    start_time = time.time()
    response.status_code = 200
    result = None
    error = None
    
    try:
        tools = get_research_tools()
        
        # Validate tool exists
        if not tools.has_tool(request.tool_name):
            response.status_code = 404
        else:
            result = await tools.execute(
                request.tool_name,
                request.parameters,
                request.secret,
            )
            if isinstance(result, dict) and result.get("success") is False:
                response.status_code = 503
                error = "Tool execution is unavailable."
                result = None
    except Exception as exc:
        denied = isinstance(exc, PermissionError)
        response.status_code = 403 if denied else 502
        error = "Tool access denied." if denied else "Tool execution failed."
        result = None

    # Only this route's unknown-tool error is exposed; provider exceptions stay sanitized.
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Tool '{request.tool_name}' not found")

    return ToolResponse(
        success=error is None,
        data=result,
        error=error,
        tool_name=request.tool_name,
        execution_time_ms=(time.time() - start_time) * 1000,
    )

