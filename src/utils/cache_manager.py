import hashlib
import json
import logging
from collections import OrderedDict
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class RecommendationCache:
    def __init__(self, config):
        self.max_size = config.get("cache.max_size", 100)
        self._store = OrderedDict()

    def _generate_key(self, data_dict: Dict[str, Any]) -> str:
        normalized = {
            "age": data_dict.get("age"),
            "gender": data_dict.get("gender"),
            "abnormal_tests": sorted(data_dict.get("abnormal_tests", [])),
            "symptoms": (
                data_dict.get("symptoms", "").lower().strip()
                if data_dict.get("symptoms")
                else ""
            ),
        }
        serialized = json.dumps(normalized, sort_keys=True)
        return hashlib.md5(serialized.encode("utf-8")).hexdigest()

    def get(self, input_data: Any) -> Optional[Any]:
        data_dict = input_data.model_dump()
        key = self._generate_key(data_dict)

        if key in self._store:
            self._store.move_to_end(key)
            logger.debug(f"Cache hit for key: {key}")
            return self._store[key]
        
        logger.debug(f"Cache miss for key: {key}")
        return None

    def set(self, input_data: Any, result: Any) -> None:
        data_dict = input_data.model_dump()
        key = self._generate_key(data_dict)

        if key in self._store:
            self._store.move_to_end(key)

        self._store[key] = result

        if len(self._store) > self.max_size:
            removed_key, _ = self._store.popitem(last=False)
            logger.info(f"Cache full. Removed oldest key: {removed_key}")


