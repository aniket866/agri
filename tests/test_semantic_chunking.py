"""
Tests for semantic chunking functionality.

Validates that the semantic chunker:
1. Preserves semantic boundaries (paragraphs, sentences, code blocks)
2. Respects token limits
3. Maintains context through overlap
4. Handles various content types correctly
"""

import pytest
from rag.chunking import (
    SemanticChunker,
    Chunk,
    chunk_knowledge_base_entry,
    estimate_tokens,
)


class TestSemanticChunker:
    """Test suite for SemanticChunker class."""
    
    def test_basic_chunking(self):
        """Test basic document chunking with paragraphs."""
        chunker = SemanticChunker(chunk_size=100, chunk_overlap=20)
        
        content = """
        This is the first paragraph. It contains some information about agriculture.
        This is important for farmers to know.
        
        This is the second paragraph. It discusses different farming techniques.
        These techniques can improve crop yields significantly.
        
        This is the third paragraph. It provides additional context and details.
        Farmers should consider these recommendations carefully.
        """
        
        chunks = chunker.chunk_document(content.strip())
        
        # Should create multiple chunks
        assert len(chunks) > 0
        
        # Each chunk should be a Chunk object
        for chunk in chunks:
            assert isinstance(chunk, Chunk)
            assert chunk.content
            assert chunk.token_count > 0
        
        # Chunks should have sequential indices
        for i, chunk in enumerate(chunks):
            assert chunk.chunk_index == i
    
    def test_paragraph_boundary_preservation(self):
        """Test that paragraph boundaries are preserved."""
        chunker = SemanticChunker(chunk_size=200, chunk_overlap=20)
        
        para1 = "First paragraph with some content about rice cultivation."
        para2 = "Second paragraph discussing wheat farming techniques."
        para3 = "Third paragraph about sustainable agriculture practices."
        
        content = f"{para1}\n\n{para2}\n\n{para3}"
        
        chunks = chunker.chunk_document(content)
        
        # Verify paragraphs are not split mid-sentence
        for chunk in chunks:
            # Should not have incomplete sentences (basic check)
            assert not chunk.content.strip().endswith(',')
    
    def test_code_block_preservation(self):
        """Test that code blocks are kept intact."""
        chunker = SemanticChunker(chunk_size=150, chunk_overlap=20)
        
        content = """
        Here is some text before the code.
        
        ```python
        def calculate_yield(area, production):
            return production / area
        ```
        
        Here is some text after the code.
        """
        
        chunks = chunker.chunk_document(content.strip())
        
        # Code block should be in one of the chunks
        code_found = False
        for chunk in chunks:
            if '```python' in chunk.content:
                code_found = True
                # Code block should be complete
                assert '```' in chunk.content
                assert 'def calculate_yield' in chunk.content
        
        assert code_found, "Code block should be preserved in chunks"
    
    def test_chunk_overlap(self):
        """Test that chunks have appropriate overlap for context."""
        chunker = SemanticChunker(chunk_size=100, chunk_overlap=30)
        
        content = """
        First paragraph with important context.
        
        Second paragraph with more information.
        
        Third paragraph with additional details.
        
        Fourth paragraph with final thoughts.
        """
        
        chunks = chunker.chunk_document(content.strip())
        
        if len(chunks) > 1:
            # Check that consecutive chunks have some overlapping content
            # (This is a heuristic check - exact overlap depends on semantic units)
            for i in range(len(chunks) - 1):
                chunk1_words = set(chunks[i].content.split())
                chunk2_words = set(chunks[i + 1].content.split())
                
                # Should have some common words (indicating overlap)
                common_words = chunk1_words & chunk2_words
                assert len(common_words) > 0, "Chunks should have overlapping content"
    
    def test_token_limit_respected(self):
        """Test that chunks respect the token size limit."""
        chunk_size = 100
        chunker = SemanticChunker(chunk_size=chunk_size, chunk_overlap=20)
        
        # Create a long document
        content = " ".join([
            f"This is sentence number {i} with some agricultural content."
            for i in range(50)
        ])
        
        chunks = chunker.chunk_document(content)
        
        # Each chunk should be within reasonable bounds of chunk_size
        for chunk in chunks:
            # Allow some flexibility (chunks can be slightly larger due to semantic boundaries)
            assert chunk.token_count <= chunk_size * 1.5, \
                f"Chunk {chunk.chunk_index} exceeds token limit: {chunk.token_count}"
    
    def test_metadata_preservation(self):
        """Test that metadata is preserved in chunks."""
        chunker = SemanticChunker(chunk_size=100, chunk_overlap=20)
        
        content = "Some agricultural content that will be chunked."
        metadata = {
            "source": "Test Source",
            "year": 2023,
            "topic": "agriculture",
        }
        doc_id = "test_doc_001"
        
        chunks = chunker.chunk_document(content, metadata, doc_id)
        
        for chunk in chunks:
            assert chunk.metadata["source"] == "Test Source"
            assert chunk.metadata["year"] == 2023
            assert chunk.metadata["topic"] == "agriculture"
            assert chunk.parent_id == doc_id
    
    def test_empty_content(self):
        """Test handling of empty content."""
        chunker = SemanticChunker()
        
        chunks = chunker.chunk_document("")
        assert len(chunks) == 0
        
        chunks = chunker.chunk_document("   ")
        assert len(chunks) == 0
    
    def test_short_content_no_split(self):
        """Test that short content is not unnecessarily split."""
        chunker = SemanticChunker(chunk_size=500, chunk_overlap=50)
        
        content = "This is a short piece of content that should not be split."
        
        chunks = chunker.chunk_document(content)
        
        # Should create only one chunk
        assert len(chunks) == 1
        assert chunks[0].content == content


class TestKnowledgeBaseChunking:
    """Test chunking of knowledge base entries."""
    
    def test_chunk_kb_entry(self):
        """Test chunking a knowledge base entry."""
        entry = {
            "id": "kb_test_001",
            "title": "Test Agricultural Topic",
            "content": "This is a test content. " * 50,  # Long content
            "citation": "Test Citation",
            "source": "Test Source",
            "year": 2023,
            "tags": ["test", "agriculture"],
            "topic": "test_topic",
        }
        
        chunks = chunk_knowledge_base_entry(entry)
        
        # Should create chunks
        assert len(chunks) > 0
        
        # Each chunk should have metadata from entry
        for chunk in chunks:
            assert chunk.metadata["title"] == "Test Agricultural Topic"
            assert chunk.metadata["source"] == "Test Source"
            assert chunk.metadata["year"] == 2023
            assert "test" in chunk.metadata["tags"]
            assert chunk.parent_id == "kb_test_001"


class TestTokenEstimation:
    """Test token estimation functionality."""
    
    def test_estimate_tokens_basic(self):
        """Test basic token estimation."""
        text = "This is a simple sentence."
        tokens = estimate_tokens(text)
        
        # Should return a reasonable estimate
        assert tokens > 0
        assert tokens < len(text)  # Tokens should be less than characters
    
    def test_estimate_tokens_empty(self):
        """Test token estimation with empty text."""
        assert estimate_tokens("") == 0
        assert estimate_tokens(None) == 0
    
    def test_estimate_tokens_long_text(self):
        """Test token estimation with longer text."""
        text = "This is a longer piece of text. " * 20
        tokens = estimate_tokens(text)
        
        # Should scale with text length
        assert tokens > 50


class TestSemanticUnitSplitting:
    """Test semantic unit splitting logic."""
    
    def test_paragraph_splitting(self):
        """Test that text is split into paragraphs correctly."""
        chunker = SemanticChunker(chunk_size=1000)  # Large size to avoid chunking
        
        content = """First paragraph.
        
        Second paragraph.
        
        Third paragraph."""
        
        units = chunker._split_into_semantic_units(content)
        
        # Should have 3 units (one per paragraph)
        assert len(units) == 3
        assert "First paragraph" in units[0]
        assert "Second paragraph" in units[1]
        assert "Third paragraph" in units[2]
    
    def test_code_block_as_unit(self):
        """Test that code blocks are treated as single units."""
        chunker = SemanticChunker(chunk_size=1000)
        
        content = """Text before.
        
        ```python
        def test():
            pass
        ```
        
        Text after."""
        
        units = chunker._split_into_semantic_units(content)
        
        # Should have code block as a separate unit
        code_unit = None
        for unit in units:
            if '```python' in unit:
                code_unit = unit
                break
        
        assert code_unit is not None
        assert 'def test():' in code_unit
        assert '```' in code_unit


class TestIntegrationWithRetriever:
    """Integration tests with the RAG retriever."""
    
    def test_retriever_with_chunking(self):
        """Test that retriever works with semantic chunking enabled."""
        from rag.retriever import RAGRetriever
        
        # Create retriever with chunking
        retriever = RAGRetriever(use_chunking=True, chunk_size=512)
        
        # Should have processed documents
        assert len(retriever.processed_docs) > 0
        
        # Test retrieval
        results = retriever.retrieve("nitrogen management in rice", top_k=3)
        
        assert len(results) > 0
        for result in results:
            assert "content" in result
            assert "relevance_score" in result
    
    def test_retriever_without_chunking(self):
        """Test that retriever works without chunking (baseline)."""
        from rag.retriever import RAGRetriever
        
        # Create retriever without chunking
        retriever = RAGRetriever(use_chunking=False)
        
        # Should use original documents
        assert len(retriever.processed_docs) == len(retriever.docs)
        
        # Test retrieval
        results = retriever.retrieve("wheat rust management", top_k=3)
        
        assert len(results) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
