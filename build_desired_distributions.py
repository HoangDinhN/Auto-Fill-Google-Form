import json
import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parent
DOCX_PATH = ROOT / "Google_Form_Questions_and_Answer_Choices.docx"
QUESTIONS_PATH = ROOT / "form-questions.json"
OUTPUT_PATH = ROOT / "desired-distributions.js"


def document_paragraph_texts(path):
    document = Document(path)
    for paragraph in document.element.body.iter(qn("w:p")):
        text = "".join(node.text or "" for node in paragraph.iter(qn("w:t")))
        if text.strip():
            yield text.strip()


def extract_percentages(path):
    values = []
    reached_first_question = False
    for text in document_paragraph_texts(path):
        if re.match(r"^1\.\s", text):
            reached_first_question = True
        if not reached_first_question:
            continue
        if "%" not in text:
            continue
        before_percent = text.split("%", 1)[0]
        numbers = re.findall(r"\d+(?:[.,]\d+)?", before_percent)
        if numbers:
            values.append(float(numbers[-1].replace(",", ".")))
    return values


def flatten_questions(data):
    flattened = []
    for section in data["sections"]:
        shared_options = section.get("sharedOptions")
        for question in section["questions"]:
            options = question.get("options") or shared_options
            if not options:
                raise ValueError(f"Question has no answer choices: {question['question']}")
            flattened.append({**question, "options": options})
    return flattened


def build_distributions(questions, percentages):
    expected_count = sum(len(question["options"]) for question in questions)
    if len(percentages) != expected_count:
        raise ValueError(
            f"Found {len(percentages)} percentages in Word, expected {expected_count}."
        )

    result = []
    cursor = 0
    for index, question in enumerate(questions, start=1):
        option_count = len(question["options"])
        question_percentages = percentages[cursor : cursor + option_count]
        cursor += option_count
        total = sum(question_percentages)
        if abs(total - 100) > 0.01:
            raise ValueError(
                f"Question {index} totals {total:g}%, expected 100%: {question['question']}"
            )

        result.append(
            {
                "number": index,
                "id": question["id"],
                "question": question["question"],
                "options": [
                    {"label": label, "percent": percentage}
                    for label, percentage in zip(
                        question["options"], question_percentages, strict=True
                    )
                ],
            }
        )
    return result


def main():
    with QUESTIONS_PATH.open("r", encoding="utf-8") as stream:
        questions_data = json.load(stream)

    questions = flatten_questions(questions_data)
    percentages = extract_percentages(DOCX_PATH)
    distributions = build_distributions(questions, percentages)
    payload = json.dumps(distributions, ensure_ascii=False, indent=2)
    OUTPUT_PATH.write_text(
        "// Generated from Google_Form_Questions_and_Answer_Choices.docx.\n"
        f"globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS = Object.freeze({payload});\n",
        encoding="utf-8",
    )
    print(
        f"Generated {OUTPUT_PATH.name}: {len(distributions)} questions, "
        f"{len(percentages)} answer percentages."
    )


if __name__ == "__main__":
    main()
