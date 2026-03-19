from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    map_file: str
    time_limit_hours: int = Field(default=24, ge=24)
    collect_all: bool = False
    start_override: tuple[int, int] | None = None

class UpdateStepRequest(BaseModel):
    currentStep: int
