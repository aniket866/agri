"""
RAG Retriever — TF-IDF based document retrieval using scikit-learn.
No external vector DB required.

Enhanced with semantic chunking for better context preservation.
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
import logging
from .knowledge_base import KNOWLEDGE_BASE
from .chunking import SemanticChunker, chunk_knowledge_base_entry

logger = logging.getLogger(__name__)


class RAGRetriever:
    def __init__(self, use_chunking: bool = True, chunk_size: int = 512):
        """
        Initialize the RAG retriever.
        
        Args:
            use_chunking: Whether to use semantic chunking for long documents
            chunk_size: Target chunk size in tokens (only used if use_chunking=True)
        """
        self.use_chunking = use_chunking
        self.docs = KNOWLEDGE_BASE
        
        # Process documents with semantic chunking if enabled
        if use_chunking:
            self.chunker = SemanticChunker(chunk_size=chunk_size)
            self.processed_docs = self._process_with_chunking()
            logger.info(
                f"Processed {len(self.docs)} documents into "
                f"{len(self.processed_docs)} semantic chunks"
            )
        else:
            self.processed_docs = self.docs
            logger.info(f"Using {len(self.docs)} documents without chunking")
        
        # Build corpus: title + content + tags joined
        corpus = [
            f"{d['title']} {d['content']} {' '.join(d.get('tags', []))}"
            for d in self.processed_docs
        ]
        self.vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            max_features=5000,
        )
        self.tfidf_matrix = self.vectorizer.fit_transform(corpus)
    
    def _process_with_chunking(self) -> list[dict]:
        """
        Process knowledge base entries with semantic chunking.
        
        For entries with long content, this splits them into semantically
        coherent chunks while preserving metadata and context.
        
        Returns:
            List of processed document dicts (may include chunks)
        """
        processed = []
        
        for entry in self.docs:
            content = entry.get("content", "")
            
            # Only chunk if content is substantial (>600 chars as heuristic)
            if len(content) > 600:
                chunks = chunk_knowledge_base_entry(entry, self.chunker)
                
                # Convert chunks to document format
                for chunk in chunks:
                    chunk_doc = {
                        "id": f"{entry['id']}_chunk_{chunk.chunk_index}",
                        "title": entry["title"],
                        "content": chunk.content,
                        "citation": entry["citation"],
                        "source": entry["source"],
                        "year": entry["year"],
                        "tags": entry["tags"],
                        "topic": entry["topic"],
                        "is_chunk": True,
                        "parent_id": entry["id"],
                        "chunk_index": chunk.chunk_index,
                        "token_count": chunk.token_count,
                    }
                    processed.append(chunk_doc)
            else:
                # Keep short entries as-is
                entry_copy = dict(entry)
                entry_copy["is_chunk"] = False
                processed.append(entry_copy)
        
        return processed

    def retrieve(self, query: str, top_k: int = 3) -> list[dict]:
        """
        Return the top_k most relevant knowledge base entries for a query.
        
        Uses semantic chunking to ensure retrieved content is contextually coherent.
        """
        query_vec = self.vectorizer.transform([query])
        scores = cosine_similarity(query_vec, self.tfidf_matrix).flatten()
        top_indices = np.argsort(scores)[::-1][:top_k * 2]  # Get more candidates
        
        results = []
        seen_parents = set()
        
        for idx in top_indices:
            if len(results) >= top_k:
                break
                
            if scores[idx] > 0.01:   # minimum relevance threshold
                entry = dict(self.processed_docs[idx])
                entry["relevance_score"] = round(float(scores[idx]), 4)
                
                # If using chunking, avoid duplicate parent documents
                if self.use_chunking and entry.get("is_chunk"):
                    parent_id = entry.get("parent_id")
                    if parent_id in seen_parents:
                        continue  # Skip duplicate chunks from same document
                    seen_parents.add(parent_id)
                
                results.append(entry)
        
        return results


# Singleton instance — loaded once at startup
_retriever_instance: RAGRetriever | None = None


def get_retriever(use_chunking: bool = True) -> RAGRetriever:
    """
    Get or create the singleton retriever instance.
    
    Args:
        use_chunking: Whether to enable semantic chunking (default: True)
    """
    global _retriever_instance
    if _retriever_instance is None:
        _retriever_instance = RAGRetriever(use_chunking=use_chunking)
    return _retriever_instance
