from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import re
from difflib import SequenceMatcher
import Levenshtein
import whisper
import os
import tempfile
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="English Learning API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load questions data
with open('questions.json', 'r', encoding='utf-8') as f:
    questions = json.load(f)

# Load Whisper model (PRODUCTION RECOMMENDATION: Use 'base' for balance of speed/accuracy)
# Options: tiny, base, small, medium, large
# - tiny: Fastest, least accurate
# - base: Good balance (RECOMMENDED for production)
# - small: Better accuracy, slower
# - medium/large: Best accuracy, much slower
try:
    model = whisper.load_model("base")
    logger.info("Whisper model loaded successfully")
except Exception as e:
    logger.error(f"Failed to load Whisper model: {e}")
    model = None

class Answer(BaseModel):
    question_id: int
    user_answer: str

def mask_sentence(sentence, keywords):
    masked = sentence
    hints = []
    for keyword in keywords:
        pattern = re.compile(r'\b' + re.escape(keyword) + r'\b', flags=re.IGNORECASE)
        match = pattern.search(sentence)
        if match:
            hints.append({"word": match.group(), "mask": '_' * len(keyword)})
            masked = pattern.sub('_' * len(keyword), masked)
    return masked, hints

def normalize_text(text):
    # Number word mappings for better accuracy
    number_map = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', 
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
        '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', 
        '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
        '18': 'eighteen', '19': 'nineteen', '20': 'twenty'
    }
    
    text = text.lower().strip()
    
    # Replace numbers with words
    for num, word in number_map.items():
        text = re.sub(r'\b' + num + r'\b', word, text)
    
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def calculate_similarity(correct, user_input):
    # Normalize both for comparison
    correct_normalized = re.sub(r'[^a-z0-9\s]', '', correct.lower()).strip()
    user_normalized = re.sub(r'[^a-z0-9\s]', '', user_input.lower()).strip()
    
    # Perfect match after removing punctuation
    if correct_normalized == user_normalized:
        return 1.0, "Perfect!"
    
    # Check for spacing issues (concatenation errors)
    correct_no_spaces = re.sub(r'\s+', '', correct_normalized)
    user_no_spaces = re.sub(r'\s+', '', user_normalized)
    
    if correct_no_spaces == user_no_spaces:
        return 0.92, "Spacing error - check for missing spaces between words"
    
    # Split into words, ignoring punctuation
    correct_words = correct_normalized.split()
    user_words = user_normalized.split()
    
    # Function words (articles, auxiliaries)
    function_words = {'a', 'an', 'the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did'}
    
    missing_words = []
    typos = []
    extra_words = []
    
    # Find missing and extra words
    correct_set = set(correct_words)
    user_set = set(user_words)
    
    missing = correct_set - user_set
    extra = user_set - correct_set
    
    # Check for typos in missing/extra words
    for missing_word in list(missing):
        for extra_word in list(extra):
            if Levenshtein.distance(missing_word, extra_word) <= 2:
                typos.append(f"{extra_word} → {missing_word}")
                missing.remove(missing_word)
                extra.remove(extra_word)
                break
    
    missing_words = list(missing)
    extra_words = list(extra)
    
    # Calculate base similarity
    intersection = len(correct_set.intersection(user_set))
    base_score = intersection / len(correct_set) if correct_set else 0
    
    # Apply penalties
    score = base_score
    feedback_parts = []
    
    # Typo penalty (minor)
    if typos:
        score *= 0.95
        feedback_parts.append(f"Typos: {', '.join(typos)}")
    
    # Missing function words penalty
    missing_function = [w for w in missing_words if w in function_words]
    if missing_function:
        score *= 0.85
        feedback_parts.append(f"Missing articles/auxiliaries: {', '.join(missing_function)}")
    
    # Missing content words penalty (severe)
    missing_content = [w for w in missing_words if w not in function_words]
    if missing_content:
        score *= 0.5
        feedback_parts.append(f"Missing key words: {', '.join(missing_content)}")
    
    # Extra words penalty
    if extra_words:
        score *= 0.9
        feedback_parts.append(f"Extra words: {', '.join(extra_words)}")
    
    feedback = "; ".join(feedback_parts) if feedback_parts else "Good attempt"
    
    return min(score, 1.0), feedback

@app.get("/")
def root():
    return {
        "message": "English Learning API", 
        "version": "1.0.0",
        "whisper_available": model is not None
    }

@app.get("/questions")
def get_all_questions():
    return questions

@app.get("/questions/{question_id}")
def get_question(question_id: int):
    question = next((q for q in questions if q["id"] == question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    masked_en, hints = mask_sentence(question["en"], question["keywords"])
    
    return {
        "id": question["id"],
        "level": question["level"],
        "topic": question["topic"],
        "tr": question["tr"],
        "masked_en": masked_en,
        "hints": hints,
        "word_count": question["word_count"]
    }

@app.post("/check-answer")
def check_answer(answer: Answer):
    question = next((q for q in questions if q["id"] == answer.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    similarity, feedback = calculate_similarity(question["en"], answer.user_answer)
    is_correct = similarity >= 0.97  # Consider 97%+ as correct
    
    return {
        "is_correct": is_correct,
        "similarity": round(similarity, 2),
        "feedback": feedback,
        "correct_answer": question["en"],
        "user_answer": answer.user_answer
    }

@app.get("/random-question")
def get_random_question():
    import random
    question = random.choice(questions)
    masked_en, hints = mask_sentence(question["en"], question["keywords"])
    
    return {
        "id": question["id"],
        "level": question["level"],
        "topic": question["topic"],
        "tr": question["tr"],
        "masked_en": masked_en,
        "hints": hints,
        "word_count": question["word_count"]
    }

# PRODUCTION SPEECH-TO-TEXT ENDPOINT WITH WHISPER
@app.post("/speech-to-text")
async def speech_to_text(file: UploadFile = File(...)):
    """
    Production-ready speech-to-text endpoint using OpenAI Whisper.
    
    Why Whisper is recommended:
    1. ✅ Offline processing (no API costs)
    2. ✅ Excellent accuracy for English learning
    3. ✅ Handles various accents and pronunciations
    4. ✅ No rate limits or API key requirements
    5. ✅ GDPR compliant (data stays on your server)
    6. ✅ Consistent performance
    
    Alternative: Google Speech-to-Text API
    - ❌ Requires API key and billing setup
    - ❌ Costs $0.006 per 15 seconds
    - ❌ Requires internet connection
    - ❌ Rate limits and quotas
    - ❌ Data sent to Google servers
    """
    
    if not model:
        raise HTTPException(
            status_code=503, 
            detail="Speech recognition service is not available"
        )
    
    # Validate file type
    if not file.content_type or not file.content_type.startswith('audio/'):
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Please upload an audio file."
        )
    
    # Validate file size (max 10MB for production)
    max_size = 10 * 1024 * 1024  # 10MB
    file_content = await file.read()
    if len(file_content) > max_size:
        raise HTTPException(
            status_code=413, 
            detail="File too large. Maximum size is 10MB."
        )
    
    temp_file_path = None
    try:
        # Create temporary file with proper extension
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        logger.info(f"Processing audio file: {file.filename}")
        
        # Transcribe with Whisper
        # language="en" forces English recognition for better accuracy
        # fp16=False for better compatibility on some systems
        result = model.transcribe(
            temp_file_path, 
            language="en",
            fp16=False,
            verbose=False
        )
        
        transcribed_text = result["text"].strip()
        
        if not transcribed_text:
            return {
                "text": "",
                "confidence": 0.0,
                "message": "No speech detected. Please try speaking more clearly."
            }
        
        logger.info(f"Transcription successful: {transcribed_text}")
        
        return {
            "text": transcribed_text,
            "confidence": 1.0,  # Whisper doesn't provide confidence scores
            "message": "Speech processed successfully"
        }
        
    except Exception as e:
        logger.error(f"Speech processing error: {e}")
        raise HTTPException(
            status_code=500, 
            detail="Could not process audio. Please try again."
        )
    
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as e:
                logger.warning(f"Could not delete temp file: {e}")

# Health check endpoint for production monitoring
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "whisper_model": "base" if model else "unavailable",
        "questions_loaded": len(questions)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)