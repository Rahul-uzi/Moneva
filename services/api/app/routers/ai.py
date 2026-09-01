from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_db
from app.models.models import User
from app.schemas.schemas import AIQueryRequest
from app.services.ai_service import process_ai_query, AIQueryResponse, ResponseType

router = APIRouter(prefix="/ai", tags=["AI Assistant"])

@router.post("/query", response_model=AIQueryResponse)
async def ai_query(
    payload: AIQueryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Processes a natural-language query for the authenticated user and returns data-grounded answers
    or structured financial action proposals.
    """
    if not payload.prompt or not payload.prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt text must not be empty."
        )

    try:
        return await process_ai_query(user_id=current_user.id, prompt=payload.prompt, db=db)
    except Exception as e:
        return AIQueryResponse(
            response_type=ResponseType.ERROR,
            message=f"MONEVA Assistant is temporarily unavailable: {str(e)}"
        )
