import json
import os
import logging
from typing import Optional
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.documents import Document
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

class ChromaVectorDB:
    def __init__(self, config):
      
        self.config = config
        self.collection_name = config.get("vector_db.collection_name", "medical_knowledge_base")
        self.persist_directory = config.get("vector_db.path", "data/chroma_db")
        self.data_path = config.get("vector_db.data_path", "data/medical_knowledge_base.json")
        
       
        embedding_provider = config.get("vector_db.embedding.provider", "openai")
        embedding_model = config.get("vector_db.embedding.model", "text-embedding-3-small")
        
        if embedding_provider == "gemini":
            logger.info("Using Gemini Embeddings")
            self.embedding_function = GoogleGenerativeAIEmbeddings(model=embedding_model)
        else:
            logger.info("Using OpenAI Embeddings")
            self.embedding_function = OpenAIEmbeddings(model=embedding_model)

    def _load_data(self):
        if not os.path.exists(self.data_path):
            raise FileNotFoundError(f"JSON data file not found: {self.data_path}")

        with open(self.data_path, "r") as file:
            data = json.load(file)
        return data

    def build(self):
        try:
            vector_store = Chroma(
                collection_name=self.collection_name,
                embedding_function=self.embedding_function,
                persist_directory=self.persist_directory,
            )

            existing_docs = vector_store.get()

            if existing_docs and existing_docs["ids"]:
                logger.info(f"Loading existing collection: {self.collection_name}")
                return vector_store

            logger.info(
                f"Collection {self.collection_name} seems empty or new. Populating..."
            )

            data = self._load_data()
            documents = []

            for i, entry in enumerate(data):
                text_to_embed = f"Category: {entry['category']}. {entry['content']}"
                metadata = {"category": entry["category"]}

                doc = Document(
                    page_content=text_to_embed, metadata=metadata, id=f"doc_{i}"
                )
                documents.append(doc)

            if documents:
                vector_store.add_documents(documents=documents)
                logger.info(f"Added {len(documents)} documents to the collection.")

            return vector_store

        except Exception as e:
            logger.error(f"Error building vector DB: {e}")
            raise e

if __name__ == "__main__":
    pass
