# Decky Project File Index

## Total Swift Files: 62

### App (2)
- Decky/App/DeckyApp.swift (App Entry, View)
- Decky/App/AppEnvironment/DependencyContainer.swift (DI Container, Service)

### Core Models (11)
- Decky/Core/Models/CardMedia.swift (Model)
- Decky/Core/Models/CardTemplate.swift (Model)
- Decky/Core/Models/CardTemplateField.swift (Model)
- Decky/Core/Models/Deck.swift (Model)
- Decky/Core/Models/FieldTextStyle.swift (Model)
- Decky/Core/Models/FieldType.swift (Model)
- Decky/Core/Models/Flashcard.swift (Model)
- Decky/Core/Models/Tag.swift (Model)
- Decky/Core/Models/TemplateField.swift (Model)
- Decky/Core/SRS/SpacedRepetitionScheduler.swift (Service/Logic)
- Decky/Core/TemplateSystem/CardSide.swift (Model/Logic)
- Decky/Core/TemplateSystem/StyledFieldText.swift (Model/Logic)

### Data Layer (4)
- Decky/Data/Repository/DeckRepositoryProtocol.swift (Protocol)
- Decky/Data/Repository/DeckRepository.swift (Service)
- Decky/Data/Store/DeckStore.swift (Store/ViewModel)
- Decky/Data/Store/DeckStudyOptionsStore.swift (Store/ViewModel)

### Features - Views (11)
- Decky/Features/DeckDetail/DeckDetailView.swift (View)
- Decky/Features/DeckDetail/DeckStatsView.swift (View)
- Decky/Features/DeckDetail/AddCardEntrySheet.swift (View)
- Decky/Features/DeckDetail/AddCardView.swift (View)
- Decky/Features/DeckList/DeckListView.swift (View)
- Decky/Features/StudySession/StudyView.swift (View)
- Decky/Features/Root/RootView.swift (View)
- Decky/Features/Templates/AddTemplateView.swift (View)
- Decky/Features/Templates/TemplateEditor.swift (View)
- Decky/Features/Templates/TemplateListView.swift (View)
- Decky/Features/Telemetry/TelemetryView.swift (View)
- Decky/Features/Import/UI/ImportAnkiFlowView.swift (View)
- Decky/Features/Import/UI/ImportDeckyPackageView.swift (View)
- Decky/Features/Import/UI/ImportEntryView.swift (View)
- Decky/Features/Import/UI/ImportProgressView.swift (View)
- Decky/Features/Import/UI/ImportResultView.swift (View)

### Features - ViewModels/Stores/Coordinator (10)
- Decky/Features/StudySession/SmartReviewGoalStore.swift (Store)
- Decky/Features/Import/AnkiApkg/AnkiImportViewModel.swift (ViewModel)
- Decky/Features/Import/Shared/ImportCoordinator.swift (Coordinator)
- Decky/Features/Import/AnkiApkg/AnkiApkgImporter.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiDatabaseReader.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiModelMapper.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiSchedulingMapper.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiCardMapper.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiTemplateConfigProtoParser.swift (Service)
- Decky/Features/Import/AnkiApkg/AnkiFieldSideDetector.swift (Service)
- Decky/Features/Import/DeckyPackage/DeckyPackageImporter.swift (Service)
- Decky/Features/Import/DeckyPackage/DeckyPackageValidator.swift (Service)
- Decky/Features/Import/Shared/ImportError.swift (Model)
- Decky/Features/Import/Shared/ImportMode.swift (Model)
- Decky/Features/Import/Shared/ImportSummary.swift (Model)
- Decky/Features/Import/Shared/ImportTypes.swift (Model)
- Decky/Features/Import/DeckyPackage/DeckyPackageFile.swift (Model)
- Decky/Features/Import/DeckyPackage/DeckyPackageModels.swift (Model)
- Decky/Features/Import/AnkiApkg/AnkiRawModels.swift (Model)
- Decky/Features/Import/AnkiApkg/ApkgUnzipper.swift (Service)

### Utils (3)
- Decky/Utils/ErrorHandling/AppError.swift (Error)
- Decky/Utils/Extensions/Color.swift (Extension)
- Decky/Utils/Logging/Logger.swift (Service)
- Decky/Utils/Storage/MediaStorageService.swift (Service)

### Tests (4)
- DeckyTests/AnkiSchedulerTests.swift (Test)
- DeckyTests/DailyCountersMigrationTests.swift (Test)
- DeckyTests/DeckStoreDueTodayTests.swift (Test)
- DeckyTests/StudyAllocatorTests.swift (Test)

---

## Key Analysis Targets

### Logic Scan (force unwraps, error handling, async race conditions)
- ViewModels/Stores: DeckStore.swift, DeckStudyOptionsStore.swift, SmartReviewGoalStore.swift, AnkiImportViewModel.swift
- Services: DeckRepository.swift, SpacedRepetitionScheduler.swift, MediaStorageService.swift, Logger.swift, Import related services
- Core: All SRS and business logic files

### UI Scan (SwiftUI Views)
- All files in Features/**/*View.swift
- Check for: invalid @State bindings, duplicated state sources, uncontrolled .task, navigation inconsistencies, business logic in View bodies

### Safety Audit
- All files: MainActor violations, UI updates from background threads, retain cycles, unsafe async patterns, @State misuse

### Test Coverage
- 4 test files exist: analyze gaps in ViewModel and UI test coverage
