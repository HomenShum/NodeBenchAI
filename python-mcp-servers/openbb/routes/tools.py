"""
Tool execution endpoints
"""
from fastapi import APIRouter, Body, HTTPException, Response
from pydantic import BaseModel
from typing import Annotated, Dict, Any, Optional
from services.openbb_client import get_openbb_client
from services.tool_registry import get_tool_registry

router = APIRouter()


class ToolRequest(BaseModel):
    """Tool execution request"""
    tool_name: str
    parameters: Dict[str, Any] = {}


class ToolResponse(BaseModel):
    """Tool execution response"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    tool_name: str
    execution_time_ms: Optional[float] = None


@router.post("/execute", response_model=ToolResponse)
async def execute_tool(request: ToolRequest, response: Response):
    """
    Execute a tool with given parameters
    
    Executes the specified OpenBB tool and returns the result
    """
    import time
    start_time = time.time()
    response.status_code = 200
    result = None
    error = None
    
    try:
        # Validate the requested tool before constructing its provider client.
        registry = get_tool_registry()
        
        # Validate tool exists
        tool_info = registry.get_tool_info(request.tool_name)
        if not tool_info:
            response.status_code = 404
        else:
            client = get_openbb_client()
            result = await client.execute_tool(
                request.tool_name,
                request.parameters,
            )
            if isinstance(result, dict) and result.get("success") is False:
                response.status_code = 503
                error = "Tool execution is unavailable."
                result = None
    except Exception:
        response.status_code = 502
        error = "Tool execution failed."
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


@router.post("/batch_execute")
async def batch_execute_tools(
    requests: Annotated[list[ToolRequest], Body(max_length=100)],
    response: Response,
):
    """
    Execute multiple tools in batch
    
    Executes multiple tools and returns all results
    """
    results = []
    response.status_code = 200
    
    for request in requests:
        item_response = Response()
        try:
            result = await execute_tool(request, item_response)
        except HTTPException as exc:
            item_response.status_code = exc.status_code
            result = ToolResponse(
                success=False,
                error="Tool not found.",
                tool_name=request.tool_name,
            )
        if response.status_code == 200 and item_response.status_code >= 400:
            response.status_code = item_response.status_code
        results.append(result)
    
    return {
        "success": all(result.success for result in results),
        "results": results,
        "count": len(results),
    }

