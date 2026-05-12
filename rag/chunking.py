"""
Semantic Chunking Module for RAG System

This module implements intelligent document chunking that preserves semantic boundaries
instead of using naive fixed-size character splits. It uses NLP tokenizers and
hierarchical parsing to maintain context coherence.

Key Features:
- Semantic boundary detection (paragraphs, sentences, code blocks)
- Token-aware chunking using tiktoken
- Hierarchical document structure preservation
- Configurable chunk sizes with overlap for context continuity
- Support for multiple content types (text, code, structured data)
"""

import re
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Try to import tiktoken for token-aware chunking
try:
    import tiktoken
    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False
    logger.warning(
        "tiktoken not available - falling back to character-based estimation. "
        "Install with: pip install tiktoken"
    )


@dataclass
class Chunk:
    """Represents a semantically coherent chunk of text."""
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    start_char: int = 0
    end_char: int = 0
    token_count: int = 0
    chunk_index: int = 0
    parent_id: Optional[str] = None
    
    def __post_init__(self):
        """Calculate token count if not provided."""
        if self.token_count == 0:
            self.token_count = estimate_tokens(self.content)


class SemanticChunker:
    """
    Intelligent document chunker that preserves semantic boundaries.
    
    This chunker uses multiple strategies to split documents:
    1. Paragraph boundaries (double newlines)
    2. Sentence boundaries (using punctuation and capitalization)
    3. Code block boundaries (for technical content)
    4. Token-aware splitting to respect model context limits
    """
    
    def __init__(
        self,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        min_chunk_size: int = 100,
        encoding_name: str = "cl100k_base",  # GPT-4, GPT-3.5-turbo encoding
    ):
        """
        Initialize the semantic chunker.
        
        Args:
            chunk_size: Target size for each chunk in tokens
            chunk_overlap: Number of tokens to overlap between chunks for context
            min_chunk_size: Minimum chunk size to avoid tiny fragments
            encoding_name: Tiktoken encoding to use for token counting
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.min_chunk_size = min_chunk_size
        self.encoding_name = encoding_name
        
        # Initialize tokenizer if available
        if TIKTOKEN_AVAILABLE:
            try:
                self.tokenizer = tiktoken.get_encoding(encoding_name)
                logger.info(f"Initialized tiktoken with encoding: {encoding_name}")
            except Exception as e:
                logger.warning(f"Failed to initialize tiktoken: {e}")
                self.tokenizer = None
        else:
            self.tokenizer = None
    
    def chunk_document(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        doc_id: Optional[str] = None,
    ) -> List[Chunk]:
        """
        Chunk a document into semantically coherent pieces.
        
        Args:
            content: The document content to chunk
            metadata: Optional metadata to attach to all chunks
            doc_id: Optional document identifier for tracking
            
        Returns:
            List of Chunk objects
        """
        if not content or not content.strip():
            return []
        
        metadata = metadata or {}
        
        # Step 1: Split into semantic units (paragraphs, code blocks, etc.)
        semantic_units = self._split_into_semantic_units(content)
        
        # Step 2: Group semantic units into chunks respecting token limits
        chunks = self._group_into_chunks(semantic_units, metadata, doc_id)
        
        logger.info(
            f"Chunked document (id={doc_id}) into {len(chunks)} chunks "
            f"from {len(semantic_units)} semantic units"
        )
        
        return chunks
    
    def _split_into_semantic_units(self, content: str) -> List[str]:
        """
        Split content into semantic units (paragraphs, code blocks, lists).
        
        This preserves natural boundaries in the text rather than splitting
        arbitrarily by character count.
        """
        units = []
        
        # Pattern to detect code blocks (markdown-style)
        code_block_pattern = r'```[\s\S]*?```'
        
        # Find all code blocks and their positions
        code_blocks = []
        for match in re.finditer(code_block_pattern, content):
            code_blocks.append((match.start(), match.end(), match.group()))
        
        # Split content around code blocks
        last_end = 0
        for start, end, code_block in code_blocks:
            # Process text before code block
            if start > last_end:
                text_before = content[last_end:start]
                units.extend(self._split_text_into_paragraphs(text_before))
            
            # Add code block as a single unit
            units.append(code_block)
            last_end = end
        
        # Process remaining text after last code block
        if last_end < len(content):
            remaining_text = content[last_end:]
            units.extend(self._split_text_into_paragraphs(remaining_text))
        
        # Filter out empty units
        units = [u.strip() for u in units if u.strip()]
        
        return units
    
    def _split_text_into_paragraphs(self, text: str) -> List[str]:
        """
        Split text into paragraphs using multiple newlines as boundaries.
        
        Falls back to sentence splitting for very long paragraphs.
        """
        # Split by double newlines (paragraph boundaries)
        paragraphs = re.split(r'\n\s*\n', text)
        
        result = []
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            # If paragraph is too long, split into sentences
            token_count = estimate_tokens(para)
            if token_count > self.chunk_size:
                sentences = self._split_into_sentences(para)
                result.extend(sentences)
            else:
                result.append(para)
        
        return result
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences using punctuation and capitalization.
        
        This is a simple heuristic-based approach that works reasonably well
        for English text.
        """
        # Pattern for sentence boundaries
        # Matches: . ! ? followed by space and capital letter, or end of string
        sentence_pattern = r'(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$'
        
        sentences = re.split(sentence_pattern, text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        return sentences
    
    def _group_into_chunks(
        self,
        units: List[str],
        metadata: Dict[str, Any],
        doc_id: Optional[str],
    ) -> List[Chunk]:
        """
        Group semantic units into chunks respecting token limits and overlap.
        
        This ensures chunks are not too large while maintaining context through overlap.
        """
        chunks = []
        current_chunk_units = []
        current_token_count = 0
        start_char = 0
        
        for i, unit in enumerate(units):
            unit_tokens = estimate_tokens(unit)
            
            # Check if adding this unit would exceed chunk size
            if current_token_count + unit_tokens > self.chunk_size and current_chunk_units:
                # Create chunk from accumulated units
                chunk = self._create_chunk(
                    current_chunk_units,
                    metadata,
                    doc_id,
                    len(chunks),
                    start_char,
                )
                chunks.append(chunk)
                
                # Prepare overlap for next chunk
                overlap_units, overlap_tokens = self._calculate_overlap(current_chunk_units)
                current_chunk_units = overlap_units
                current_token_count = overlap_tokens
                start_char = chunk.end_char - sum(len(u) for u in overlap_units)
            
            # Add current unit
            current_chunk_units.append(unit)
            current_token_count += unit_tokens
        
        # Create final chunk if there are remaining units
        if current_chunk_units:
            chunk = self._create_chunk(
                current_chunk_units,
                metadata,
                doc_id,
                len(chunks),
                start_char,
            )
            chunks.append(chunk)
        
        return chunks
    
    def _calculate_overlap(self, units: List[str]) -> tuple[List[str], int]:
        """
        Calculate which units to include in overlap for context continuity.
        
        Returns:
            Tuple of (overlap_units, overlap_token_count)
        """
        overlap_units = []
        overlap_tokens = 0
        
        # Take units from the end until we reach overlap size
        for unit in reversed(units):
            unit_tokens = estimate_tokens(unit)
            if overlap_tokens + unit_tokens > self.chunk_overlap:
                break
            overlap_units.insert(0, unit)
            overlap_tokens += unit_tokens
        
        return overlap_units, overlap_tokens
    
    def _create_chunk(
        self,
        units: List[str],
        metadata: Dict[str, Any],
        doc_id: Optional[str],
        chunk_index: int,
        start_char: int,
    ) -> Chunk:
        """Create a Chunk object from semantic units."""
        # Join units with appropriate spacing
        content = self._join_units(units)
        
        # Calculate character positions
        end_char = start_char + len(content)
        
        # Create chunk metadata
        chunk_metadata = {
            **metadata,
            "semantic_units": len(units),
            "doc_id": doc_id,
        }
        
        return Chunk(
            content=content,
            metadata=chunk_metadata,
            start_char=start_char,
            end_char=end_char,
            token_count=estimate_tokens(content),
            chunk_index=chunk_index,
            parent_id=doc_id,
        )
    
    def _join_units(self, units: List[str]) -> str:
        """
        Join semantic units with appropriate spacing.
        
        Preserves code blocks and adds paragraph breaks between text units.
        """
        result = []
        for i, unit in enumerate(units):
            result.append(unit)
            # Add spacing between units (but not after last unit)
            if i < len(units) - 1:
                # Code blocks get double newline
                if unit.startswith('```') or units[i + 1].startswith('```'):
                    result.append('\n\n')
                # Regular text gets paragraph break
                else:
                    result.append('\n\n')
        
        return ''.join(result)


def estimate_tokens(text: str, tokenizer=None) -> int:
    """
    Estimate token count for text.
    
    Uses tiktoken if available, otherwise falls back to character-based estimation.
    
    Args:
        text: Text to count tokens for
        tokenizer: Optional tiktoken tokenizer instance
        
    Returns:
        Estimated token count
    """
    if not text:
        return 0
    
    if tokenizer is not None:
        try:
            return len(tokenizer.encode(text))
        except Exception as e:
            logger.warning(f"Tokenizer failed: {e}, falling back to estimation")
    
    # Fallback: rough estimation (1 token ≈ 4 characters for English)
    return len(text) // 4


def chunk_knowledge_base_entry(
    entry: Dict[str, Any],
    chunker: Optional[SemanticChunker] = None,
) -> List[Chunk]:
    """
    Chunk a knowledge base entry into semantic pieces.
    
    This is useful for long-form content that needs to be split while
    preserving context and metadata.
    
    Args:
        entry: Knowledge base entry dict with 'content' and metadata
        chunker: Optional SemanticChunker instance (creates default if None)
        
    Returns:
        List of Chunk objects
    """
    if chunker is None:
        chunker = SemanticChunker()
    
    # Extract content and metadata
    content = entry.get("content", "")
    
    # Build metadata from entry fields
    metadata = {
        "title": entry.get("title", ""),
        "source": entry.get("source", ""),
        "year": entry.get("year", ""),
        "citation": entry.get("citation", ""),
        "tags": entry.get("tags", []),
        "topic": entry.get("topic", ""),
    }
    
    doc_id = entry.get("id", "")
    
    # Chunk the content
    chunks = chunker.chunk_document(content, metadata, doc_id)
    
    return chunks


# Singleton chunker instance for reuse
_default_chunker: Optional[SemanticChunker] = None


def get_default_chunker() -> SemanticChunker:
    """Get or create the default semantic chunker instance."""
    global _default_chunker
    if _default_chunker is None:
        _default_chunker = SemanticChunker()
    return _default_chunker
