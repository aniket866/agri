"""
Example script demonstrating semantic chunking functionality.

This script shows how the semantic chunker improves upon naive character-based
splitting by preserving semantic boundaries and maintaining context.
"""

from rag.chunking import SemanticChunker, chunk_knowledge_base_entry
from rag.retriever import RAGRetriever


def example_1_basic_chunking():
    """Example 1: Basic document chunking with semantic boundaries."""
    print("=" * 70)
    print("Example 1: Basic Semantic Chunking")
    print("=" * 70)
    
    chunker = SemanticChunker(chunk_size=150, chunk_overlap=30)
    
    content = """
    Nitrogen management is crucial for rice cultivation. Optimal nitrogen 
    application should be split into three doses: basal application at planting, 
    tillering stage application, and panicle initiation stage application.
    
    Split application improves nitrogen use efficiency by 30-40% compared to 
    single basal dose. This approach reduces nitrogen losses through leaching 
    and volatilization while ensuring adequate supply during critical growth stages.
    
    Farmers should apply 40% of nitrogen as basal dose, 30% at tillering, and 
    30% at panicle initiation. Soil testing helps determine the exact nitrogen 
    requirement based on soil organic matter and previous crop residues.
    """
    
    chunks = chunker.chunk_document(content.strip())
    
    print(f"\nOriginal content length: {len(content)} characters")
    print(f"Number of chunks created: {len(chunks)}\n")
    
    for i, chunk in enumerate(chunks):
        print(f"Chunk {i + 1}:")
        print(f"  Tokens: {chunk.token_count}")
        print(f"  Characters: {len(chunk.content)}")
        print(f"  Content preview: {chunk.content[:100]}...")
        print()


def example_2_code_block_preservation():
    """Example 2: Preserving code blocks as semantic units."""
    print("=" * 70)
    print("Example 2: Code Block Preservation")
    print("=" * 70)
    
    chunker = SemanticChunker(chunk_size=200, chunk_overlap=30)
    
    content = """
    To calculate crop yield, you can use the following Python function:
    
    ```python
    def calculate_yield(area_hectares, production_tonnes):
        '''
        Calculate crop yield in tonnes per hectare.
        
        Args:
            area_hectares: Cultivated area in hectares
            production_tonnes: Total production in tonnes
            
        Returns:
            Yield in tonnes per hectare
        '''
        if area_hectares <= 0:
            raise ValueError("Area must be positive")
        return production_tonnes / area_hectares
    ```
    
    This function helps farmers and agricultural officers quickly compute yield 
    metrics for reporting and analysis. The yield calculation is essential for 
    comparing productivity across different farms and regions.
    """
    
    chunks = chunker.chunk_document(content.strip())
    
    print(f"\nNumber of chunks: {len(chunks)}\n")
    
    for i, chunk in enumerate(chunks):
        print(f"Chunk {i + 1}:")
        has_code = "```" in chunk.content
        print(f"  Contains code block: {has_code}")
        print(f"  Tokens: {chunk.token_count}")
        if has_code:
            print(f"  Code block is complete: {'```python' in chunk.content and chunk.content.count('```') >= 2}")
        print()


def example_3_knowledge_base_chunking():
    """Example 3: Chunking knowledge base entries."""
    print("=" * 70)
    print("Example 3: Knowledge Base Entry Chunking")
    print("=" * 70)
    
    # Create a long knowledge base entry
    entry = {
        "id": "kb_example_001",
        "title": "Integrated Pest Management in Cotton",
        "content": """
        Integrated Pest Management (IPM) in cotton is a comprehensive approach 
        that combines multiple pest control strategies to minimize pesticide use 
        while maintaining crop productivity. The IPM strategy includes cultural, 
        biological, and chemical control methods.
        
        Cultural practices include crop rotation, timely sowing, and maintaining 
        optimal plant spacing. These practices create unfavorable conditions for 
        pest establishment and reduce pest pressure naturally.
        
        Biological control involves releasing beneficial insects like Trichogramma 
        egg parasitoids at a rate of 1.5 lakh per hectare. These parasitoids 
        attack pest eggs, reducing the next generation of harmful insects.
        
        Chemical control should be the last resort, used only when pest populations 
        exceed economic threshold levels. When necessary, use selective pesticides 
        that target specific pests while preserving beneficial insects.
        
        Monitoring is crucial for IPM success. Install yellow sticky traps for 
        whitefly monitoring at 15-20 traps per hectare. Regular field scouting 
        helps detect pest outbreaks early, allowing timely intervention.
        
        IPM implementation reduces pesticide use by 50% and saves Rs. 3000-5000 
        per acre compared to calendar-based spraying. This approach is both 
        economically beneficial and environmentally sustainable.
        """,
        "citation": "CICR Technical Bulletin No. 31, 2021",
        "source": "Central Institute for Cotton Research",
        "year": 2021,
        "tags": ["cotton", "IPM", "pest", "sustainable"],
        "topic": "pest_disease"
    }
    
    chunks = chunk_knowledge_base_entry(entry)
    
    print(f"\nOriginal entry length: {len(entry['content'])} characters")
    print(f"Number of chunks created: {len(chunks)}\n")
    
    for chunk in chunks:
        print(f"Chunk {chunk.chunk_index + 1}:")
        print(f"  Tokens: {chunk.token_count}")
        print(f"  Parent ID: {chunk.parent_id}")
        print(f"  Metadata preserved: {chunk.metadata['title']}")
        print(f"  Content preview: {chunk.content[:80]}...")
        print()


def example_4_retriever_comparison():
    """Example 4: Compare retrieval with and without chunking."""
    print("=" * 70)
    print("Example 4: Retriever Comparison (With vs Without Chunking)")
    print("=" * 70)
    
    query = "How to manage nitrogen in rice cultivation?"
    
    # Retriever with chunking
    print("\n--- With Semantic Chunking ---")
    retriever_chunked = RAGRetriever(use_chunking=True, chunk_size=512)
    results_chunked = retriever_chunked.retrieve(query, top_k=3)
    
    print(f"Documents processed: {len(retriever_chunked.processed_docs)}")
    print(f"Results retrieved: {len(results_chunked)}")
    
    for i, result in enumerate(results_chunked, 1):
        print(f"\nResult {i}:")
        print(f"  Title: {result['title']}")
        print(f"  Relevance: {result['relevance_score']}")
        print(f"  Is chunk: {result.get('is_chunk', False)}")
        if result.get('is_chunk'):
            print(f"  Chunk index: {result.get('chunk_index', 'N/A')}")
        print(f"  Content preview: {result['content'][:100]}...")
    
    # Retriever without chunking
    print("\n\n--- Without Chunking (Baseline) ---")
    retriever_baseline = RAGRetriever(use_chunking=False)
    results_baseline = retriever_baseline.retrieve(query, top_k=3)
    
    print(f"Documents processed: {len(retriever_baseline.processed_docs)}")
    print(f"Results retrieved: {len(results_baseline)}")
    
    for i, result in enumerate(results_baseline, 1):
        print(f"\nResult {i}:")
        print(f"  Title: {result['title']}")
        print(f"  Relevance: {result['relevance_score']}")
        print(f"  Content preview: {result['content'][:100]}...")


def example_5_overlap_demonstration():
    """Example 5: Demonstrate chunk overlap for context continuity."""
    print("=" * 70)
    print("Example 5: Chunk Overlap for Context Continuity")
    print("=" * 70)
    
    chunker = SemanticChunker(chunk_size=100, chunk_overlap=30)
    
    content = """
    Soil pH is a critical factor affecting nutrient availability. Most crops 
    thrive in soil pH range of 6.0 to 7.5. Acidic soils with pH below 6.0 
    limit phosphorus availability and increase aluminum toxicity.
    
    Liming is the primary method to correct soil acidity. Agricultural lime 
    should be applied at 2-4 tonnes per hectare based on soil test results. 
    Lime application raises pH and improves nutrient uptake by 20-35%.
    
    Regular soil testing every 3 years helps monitor pH changes and guide 
    lime application decisions. Proper pH management is essential for 
    sustainable crop production and optimal fertilizer efficiency.
    """
    
    chunks = chunker.chunk_document(content.strip())
    
    print(f"\nChunk size: {chunker.chunk_size} tokens")
    print(f"Overlap size: {chunker.chunk_overlap} tokens")
    print(f"Number of chunks: {len(chunks)}\n")
    
    for i, chunk in enumerate(chunks):
        print(f"Chunk {i + 1}:")
        print(f"  Tokens: {chunk.token_count}")
        print(f"  Content: {chunk.content}")
        
        # Show overlap with next chunk
        if i < len(chunks) - 1:
            next_chunk = chunks[i + 1]
            # Find common words (simple overlap detection)
            current_words = set(chunk.content.lower().split())
            next_words = set(next_chunk.content.lower().split())
            overlap_words = current_words & next_words
            print(f"  Overlap with next chunk: ~{len(overlap_words)} common words")
        print()


def main():
    """Run all examples."""
    print("\n")
    print("╔" + "═" * 68 + "╗")
    print("║" + " " * 15 + "SEMANTIC CHUNKING EXAMPLES" + " " * 27 + "║")
    print("╚" + "═" * 68 + "╝")
    print()
    
    examples = [
        example_1_basic_chunking,
        example_2_code_block_preservation,
        example_3_knowledge_base_chunking,
        example_4_retriever_comparison,
        example_5_overlap_demonstration,
    ]
    
    for i, example_func in enumerate(examples, 1):
        try:
            example_func()
            print("\n")
        except Exception as e:
            print(f"\n❌ Example {i} failed: {e}\n")
    
    print("=" * 70)
    print("All examples completed!")
    print("=" * 70)


if __name__ == "__main__":
    main()
