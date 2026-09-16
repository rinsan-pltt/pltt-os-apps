from fastapi import APIRouter

from .tools import router as tools_router

api_router = APIRouter()
api_router.include_router(tools_router)
